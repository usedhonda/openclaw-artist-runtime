import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it } from "vitest";
import { runCycleFeedback } from "../ui/src/App";
import { DiagnosticsView, RoomHeader, SettingsView, SongsView, roomSummaryWithDecisions } from "../ui/src/ProducerRoomApp";
import { SetupView } from "../ui/src/components/SetupView";
import { SongLifecycleTimelineCard } from "../ui/src/components/SongLifecycleTimelineCard";
import { buildConfigDraft, buildConfigUpdatePatch } from "../ui/src/configEditor";
import { buildPersonaDraft } from "../ui/src/personaEditor";
import type { DraftBoxNextActionSummary } from "../src/types";

function summary(overrides: Partial<DraftBoxNextActionSummary>): DraftBoxNextActionSummary {
  return {
    kind: "empty",
    currentLine: "Artist is: looking for the next draft",
    draftCount: 0,
    buildingCount: 0,
    nextAction: "You can: wait for the next draft notice.",
    stateKey: "test",
    ...overrides
  };
}

describe("ProducerRoomApp room header", () => {
  it("renders healthy states without an operation button", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomHeader, {
        summary: summary({
          kind: "draft_idle",
          currentLine: "Artist is: free",
          draftCount: 2,
          nextAction: "You can: choose Build from the draft box."
        })
      })
    );

    expect(html).toContain("Current Room State");
    expect(html).toContain("Artist is");
    expect(html).toContain("Artist is: free");
    expect(html).toContain("Status");
    expect(html).toContain("Healthy");
    expect(html).toContain("Nothing needed");
    expect(html).not.toContain("<button");
  });

  it("renders exactly one resume CTA for paused states", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomHeader, {
        summary: summary({
          kind: "paused",
          currentLine: "Artist is: paused",
          nextAction: "You can: resume with /resume.",
          reason: "user_paused"
        }),
        onResume: () => undefined
      })
    );

    expect(html).toContain("Status");
    expect(html).toContain("Blocked");
    expect(html).toContain("Why");
    expect(html).toContain("user_paused");
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain("Resume");
  });

  it("renders reauth_required as guidance without a false fix button", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomHeader, {
        summary: summary({
          kind: "reauth_required",
          currentLine: "Artist is: blocked by an expired lyrics AI token",
          nextAction: "You can: reauth lyrics AI. /resume will not fix it.",
          reason: "ai_provider_not_configured: 歌詞AIのトークン失効/未設定"
        })
      })
    );

    expect(html).toContain("Reauth required");
    expect(html).toContain("Lyrics AI reauth is required. /resume will not fix it.");
    expect(html).toContain("ai_provider_not_configured");
    expect(html).not.toContain("<button");
  });

  it("promotes pending producer decisions above the healthy empty state", () => {
    const promoted = roomSummaryWithDecisions(
      summary({
        kind: "empty",
        currentLine: "Artist is: looking for the next draft",
        nextAction: "You can: wait for the next draft notice."
      }),
      {
        count: 2,
        callbacks: [
          {
            callbackId: "cb1",
            action: "song_archive",
            label: "採用",
            effect: "この曲を採用する。",
            songId: "spawn_1610f3",
            songTitle: "二つの低気圧",
            stage: "asset_generation",
            createdAt: Date.parse("2026-06-27T13:25:00.000Z"),
            expiresAt: Date.parse("2026-07-27T13:25:00.000Z")
          },
          {
            callbackId: "cb2",
            action: "song_discard",
            label: "破棄",
            effect: "この曲を破棄する。",
            songId: "spawn_1610f3",
            songTitle: "二つの低気圧",
            stage: "asset_generation",
            createdAt: Date.parse("2026-06-27T13:25:00.000Z"),
            expiresAt: Date.parse("2026-07-27T13:25:00.000Z")
          }
        ]
      }
    );
    const html = renderToStaticMarkup(React.createElement(RoomHeader, { summary: promoted }));

    expect(promoted.kind).toBe("decision_pending");
    expect(html).toContain("Decision pending");
    expect(html).toContain("Artist is: waiting on 二つの低気圧");
    expect(html).toContain("choose 採用 / 破棄 in the latest Telegram notice");
    expect(html).toContain("Awaiting adoption after completion");
    expect(html).not.toContain("asset_generation");
    expect(html).not.toContain("producer decision");
    expect(html).not.toContain("Nothing needed");
  });
});

describe("ProducerRoomApp Songs and Settings views", () => {
  it("allows Room to keep the lifecycle timeline compact", () => {
    (globalThis as typeof globalThis & { React?: typeof React }).React = React;
    const html = renderToStaticMarkup(React.createElement(SongLifecycleTimelineCard, { limit: 3 }));

    expect(html).toContain("Recent 3 songs");
  });

  it("renders the song ledger and selected song detail mirror", () => {
    (globalThis as typeof globalThis & { React?: typeof React }).React = React;
    const html = renderToStaticMarkup(
      React.createElement(SongsView, {
        selectedSongId: "song-001",
        onSelectSong: () => undefined,
        onBack: () => undefined,
        songs: [
          {
            songId: "song-001",
            title: "七万円のスクランブル",
            status: "suno_take_url_ready",
            runCount: 2,
            selectedTakeId: "take-1"
          },
          {
            songId: "song-002",
            title: "次の曲",
            status: "archived",
            runCount: 1,
            selectedTakeId: "take-2"
          }
        ]
      })
    );
    const selectedIndex = html.indexOf("七万円のスクランブル");
    const detailIndex = html.indexOf("曲の詳細を読み込み中。");
    const nextSongIndex = html.indexOf("次の曲");

    expect(html).toContain("Songs");
    expect(html).toContain("七万円のスクランブル");
    expect(html).toContain("2 runs");
    expect(html).toContain("Listening URL ready");
    expect(selectedIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeGreaterThan(selectedIndex);
    expect(nextSongIndex).toBeGreaterThan(detailIndex);
    expect(html).toContain("only repeats adoption decisions when they are pending");
    expect(html).not.toContain("← Songs");
    expect(html).not.toContain("song-detail-breadcrumb-link");
    expect(html).not.toContain("song-001 · run");
    expect(html).not.toContain("suno_take_url_ready");
  });

  it("paginates the song ledger instead of rendering the whole archive at once", () => {
    (globalThis as typeof globalThis & { React?: typeof React }).React = React;
    const songs = Array.from({ length: 12 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        songId: `song-${number}`,
        title: `Song ${number}`,
        status: index % 2 === 0 ? "archived" : "take_selected",
        runCount: index,
        selectedTakeId: `take-${number}`
      };
    });
    const html = renderToStaticMarkup(
      React.createElement(SongsView, {
        selectedSongId: null,
        onSelectSong: () => undefined,
        onBack: () => undefined,
        songs
      })
    );

    expect(html).toContain("1-5 / 12 songs");
    expect(html).toContain("Song 001");
    expect(html).toContain("Song 005");
    expect(html).toContain("0 runs");
    expect(html).toContain("Adopted");
    expect(html).toContain("Awaiting adoption");
    expect(html).not.toContain("Song 006");
    expect(html).not.toContain("song-001 · run");
    expect(html).not.toContain("take-001");
    expect(html).not.toContain("take_selected");
    expect(html).not.toContain("archived");
  });

  it("renders steer settings and builds a config update patch from the draft", () => {
    const config = {
      ui: { locale: "auto" as const },
      artist: { artistId: "artist", workspaceRoot: "/tmp/artist" },
      music: { suno: { dailyCreditLimit: 4, monthlyCreditLimit: 40, monthlyGenerationBudget: 50, maxGenerationsPerDay: 4, minMinutesBetweenCreates: 20, driver: "mock" as const, submitMode: "skip" as const } },
      autopilot: { enabled: true, dryRun: true, songsPerWeek: 3, cycleIntervalMinutes: 60, planningTimeoutDays: 7, producerDigest: "daily" as const },
      distribution: {
        enabled: true,
        liveGoArmed: false,
        dailySharing: "auto" as const,
        officialRelease: "manual_approval" as const,
        platforms: {
          x: { enabled: true, liveGoArmed: false, authority: "draft_only" as const, maxPostsPerDay: 3, maxRepliesPerDay: 0 },
          instagram: { enabled: false, liveGoArmed: false, authority: "draft_only" as const },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" as const }
        }
      },
      telegram: { enabled: false, pollIntervalMs: 2000, notifyStages: true, acceptFreeText: true },
      artistPulse: { enabled: false, minIntervalHours: 12 },
      commission: { enabled: false },
      songSpawn: { enabled: true, minIntervalHours: 24 },
      aiReview: { provider: "mock" as const },
      safety: { auditLog: true }
    };
    const draft = { ...buildConfigDraft(config), songsPerWeek: "5", uiLocale: "ja" as const };
    const patch = buildConfigUpdatePatch(draft);
    const html = renderToStaticMarkup(
      React.createElement(SettingsView, {
        config,
        draft,
        dirty: true,
        busy: false,
        validationError: null,
        onUpdateDraft: () => undefined,
        onSave: () => undefined,
        onReset: () => undefined,
        onRefresh: () => undefined
      })
    );

    expect(patch.autopilot.songsPerWeek).toBe(5);
    expect(patch.ui.locale).toBe("ja");
    expect(html).toContain("Autopilot");
    expect(html).toContain("Display language");
    expect(html).toContain("Auto");
    expect(html).toContain("日本語");
    expect(html).toContain("English");
    expect(html).toContain("Suno Budget");
    expect(html).toContain("Platforms");
    expect(html).toContain("Telegram");
    expect(html).toContain("Dashboard URL");
    expect(html).toContain("AI / Audit");
    expect(html).toContain("Creation driver");
    expect(html).toContain("Browser worker");
    expect(html).toContain("Create button");
    expect(html).toContain("Live submit");
    expect(html).toContain("Instagram");
    expect(html).toContain("TikTok");
    expect(html).toContain("Save settings");
    expect(html).toContain("Frozen");
    expect(html).toContain("Draft only");
    expect(html).not.toContain("/tmp/artist");
    expect(html).not.toContain("Live-Go Arm");
    expect(html).not.toContain("Suno Submit Mode");
    expect(html).not.toContain("曲づくりの実行方法");
    expect(html).not.toContain("作成ボタン");
    expect(html).not.toContain("Suno 操作方法");
    expect(html).not.toContain("Suno 送信");
    expect(html).not.toContain("Instagram 権限");
    expect(html).not.toContain("TikTok 権限");
    expect(html).not.toContain("Instagram の扱い");
    expect(html).not.toContain("TikTok の扱い");
    expect(html).not.toContain("workspace configured");
    expect(html).not.toContain("auto publish");
    expect(html).not.toContain(">mock<");
    expect(html).not.toContain(">skip<");
  });

  it("disables settings save and reset when there are no unsaved changes", () => {
    const config = {
      ui: { locale: "auto" as const },
      artist: { artistId: "artist", workspaceRoot: "/tmp/artist" },
      music: { suno: { dailyCreditLimit: 4, monthlyCreditLimit: 40, monthlyGenerationBudget: 50, maxGenerationsPerDay: 4, minMinutesBetweenCreates: 20, driver: "mock" as const, submitMode: "skip" as const } },
      autopilot: { enabled: true, dryRun: true, songsPerWeek: 3, cycleIntervalMinutes: 60, planningTimeoutDays: 7, producerDigest: "daily" as const },
      distribution: {
        enabled: true,
        liveGoArmed: false,
        dailySharing: "auto" as const,
        officialRelease: "manual_approval" as const,
        platforms: {
          x: { enabled: true, liveGoArmed: false, authority: "draft_only" as const, maxPostsPerDay: 3, maxRepliesPerDay: 0 },
          instagram: { enabled: false, liveGoArmed: false, authority: "draft_only" as const },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" as const }
        }
      },
      telegram: { enabled: false, pollIntervalMs: 2000, notifyStages: true, acceptFreeText: true },
      artistPulse: { enabled: false, minIntervalHours: 12 },
      commission: { enabled: false },
      songSpawn: { enabled: true, minIntervalHours: 24 },
      aiReview: { provider: "mock" as const },
      safety: { auditLog: true }
    };
    const html = renderToStaticMarkup(
      React.createElement(SettingsView, {
        config,
        draft: buildConfigDraft(config),
        dirty: false,
        busy: false,
        validationError: null,
        onUpdateDraft: () => undefined,
        onSave: () => undefined,
        onReset: () => undefined,
        onRefresh: () => undefined
      })
    );

    expect(html).toMatch(/<button class="primary" type="button" disabled="">Save settings<\/button>/);
    expect(html).toMatch(/<button type="button" disabled="">Reset changes<\/button>/);
  });

  it("renders env-forced settings as read-only with source disclosure", () => {
    const config = {
      fieldMeta: {
        "autopilot.dryRun": { source: "env" as const, editable: false, envVar: "OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE" },
        "music.suno.connectionMode": { source: "env" as const, editable: false, envVar: "OPENCLAW_SUNO_LIVE" },
        "music.suno.driver": { source: "env" as const, editable: false, envVar: "OPENCLAW_SUNO_LIVE" },
        "music.suno.submitMode": { source: "env" as const, editable: false, envVar: "OPENCLAW_SUNO_LIVE" },
        "dashboard.baseUrl": { source: "env" as const, editable: true, envVar: "OPENCLAW_DASHBOARD_BASE_URL" },
        "aiReview.provider": { source: "env" as const, editable: false, envVar: "OPENCLAW_AI_REVIEW_PROVIDER" }
      },
      diagnostics: {
        newsX: {
          rssUrls: { envVar: "OPENCLAW_NEWS_RSS_URLS", source: "env" as const, editable: false as const, configured: true, count: 2 },
          browserResolve: { envVar: "OPENCLAW_NEWS_BROWSER_RESOLVE", source: "env" as const, editable: false as const, enabled: true },
          articleResolve: { envVar: "OPENCLAW_NEWS_ARTICLE_RESOLVE", source: "env" as const, editable: false as const, enabled: false },
          firefoxProfile: { envVar: "OPENCLAW_X_FIREFOX_PROFILE", source: "env" as const, editable: false as const, configured: true },
          tcoFetch: { envVar: "OPENCLAW_X_TCO_FETCH_ENABLED", source: "env" as const, editable: false as const, enabled: true }
        },
        telegram: {
          active: true,
          reason: "ready" as const,
          botToken: { envVar: "TELEGRAM_BOT_TOKEN", source: "env" as const, editable: false as const, configured: true },
          ownerUserIds: { envVar: "TELEGRAM_OWNER_USER_IDS", source: "env" as const, editable: false as const, configured: true, count: 2 },
          notifier: { envVar: "OPENCLAW_TELEGRAM_NOTIFIER", source: "env" as const, editable: false as const, enabled: true }
        }
      },
      ui: { locale: "auto" as const },
      dashboard: { baseUrl: "https://tailnet.example.test" },
      artist: { artistId: "artist", workspaceRoot: "/tmp/artist" },
      music: { suno: { dailyCreditLimit: 4, monthlyCreditLimit: 40, monthlyGenerationBudget: 50, maxGenerationsPerDay: 4, minMinutesBetweenCreates: 20, driver: "playwright" as const, submitMode: "live" as const } },
      autopilot: { enabled: true, dryRun: false, songsPerWeek: 3, cycleIntervalMinutes: 60, planningTimeoutDays: 7, producerDigest: "daily" as const },
      distribution: {
        enabled: true,
        liveGoArmed: false,
        dailySharing: "auto" as const,
        officialRelease: "manual_approval" as const,
        platforms: {
          x: { enabled: true, liveGoArmed: false, authority: "draft_only" as const, maxPostsPerDay: 3, maxRepliesPerDay: 0 },
          instagram: { enabled: false, liveGoArmed: false, authority: "draft_only" as const },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" as const }
        }
      },
      telegram: { enabled: false, pollIntervalMs: 2000, notifyStages: true, acceptFreeText: true },
      artistPulse: { enabled: false, minIntervalHours: 12 },
      commission: { enabled: false },
      songSpawn: { enabled: true, minIntervalHours: 24 },
      aiReview: { provider: "openclaw" as const },
      safety: { auditLog: true }
    };
    const html = renderToStaticMarkup(
      React.createElement(SettingsView, {
        config,
        draft: buildConfigDraft(config),
        dirty: false,
        busy: false,
        validationError: null,
        onUpdateDraft: () => undefined,
        onSave: () => undefined,
        onReset: () => undefined,
        onRefresh: () => undefined
      })
    );

    expect(html).toContain("source: env OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE");
    expect(html).toContain("source: env OPENCLAW_SUNO_LIVE");
    expect(html).toContain("source: env OPENCLAW_DASHBOARD_BASE_URL");
    expect(html).toContain("source: env OPENCLAW_AI_REVIEW_PROVIDER");
    expect(html).toContain("editable fallback");
    expect(html).toContain("read-only here");
    expect(html).toContain("disabled");
    expect(html).toContain("Runtime inputs");
    expect(html).toContain("News RSS feeds");
    expect(html).toContain("X Firefox profile");
    expect(html).toContain("Telegram readiness");
    expect(html).toContain("Telegram bot token");
    expect(html).toContain("2 configured");
    expect(html).toContain("reason: ready");
    expect(html).not.toContain("secret-token-value");
    expect(html).not.toContain("PrivateFirefoxProfile");
  });

  it("renders Setup as canonical inputs without raw MD tabs", () => {
    const persona = {
      artist: {
        artistName: "Glass Commuter",
        identityLine: "Turns commute damage into songs.",
        soundDna: "dry drums, low synth",
        obsessions: "station light, receipts",
        lyricsRules: "no slogans",
        socialVoice: "plain and short"
      },
      soul: {
        conversationTone: "short and precise",
        refusalStyle: "refuse weak ideas plainly"
      },
      identity: { text: "# IDENTITY\n\nraw identity" },
      producer: { text: "# PRODUCER\n\nraw producer" },
      inner: { text: "# INNER\n\nraw inner" },
      setup: { completed: false, needsSetup: true, reasons: ["missing_completion_marker"], reasonsText: "setup not completed" },
      audit: {
        summary: { filled: 7, thin: 1, missing: 0 },
        fields: [
          { field: "artistName", status: "filled" },
          { field: "soundDna", status: "thin", reason: "shorter_than_20_chars" },
          { field: "socialVoice", status: "missing", reason: "empty_or_absent" }
        ],
        issues: [
          { code: "conflicting_language_policy", file: "persona", detail: "日本語80%/英語20% / 日本語70%/英語30%" },
          { code: "duplicate_suno_profile", file: "ARTIST.md", detail: "Suno Production Profile appears more than once" }
        ],
        customSections: ["Shibuya Lens"]
      },
      aiDraftSupported: ["artist", "soul", "producer"] as ["artist", "soul", "producer"],
      provider: "mock"
    };
    const html = renderToStaticMarkup(
      React.createElement(SetupView, {
        persona,
        draft: buildPersonaDraft(persona),
        dirty: { artist: true, soul: false, identity: false, producer: false, inner: false },
        busyKey: null,
        onUpdateArtist: () => undefined,
        onUpdateSoul: () => undefined,
        onUpdateSnapshot: () => undefined,
        onSaveLayer: () => undefined,
        onReset: () => undefined,
        onRefresh: () => undefined,
        onPropose: () => undefined,
        onProposeMissing: () => undefined,
        onProposeReview: () => undefined,
        onProposeDedupe: () => undefined,
        aiSuggestions: {
          soundDna: { draft: "dry drums, low synth, sharper field texture", mode: "review_all", reasoning: "tighten sound" }
        },
        onApplySuggestion: () => undefined,
        onComplete: () => undefined
      })
    );

    expect(html).toContain("アーティスト設定");
    expect(html).toContain("5つのファイル");
    expect(html).toContain("ARTIST.md");
    expect(html).toContain("SOUL.md");
    expect(html).toContain("PRODUCER.md");
    expect(html).toContain("IDENTITY.md");
    expect(html).toContain("INNER.md");
    expect(html).toContain("入力");
    expect(html).toContain("必須");
    expect(html).toContain("自動");
    expect(html).toContain("内部");
    expect(html).toContain("ここに書く");
    expect(html).toContain("書かない");
    expect(html).toContain("何のファイルか");
    expect(html).not.toContain("決まること");
    expect(html).toContain("Suno prompt と日々の曲案に一番強く効く");
    expect(html).toContain("任意なので空でも setup 完了は止めない");
    expect(html).toContain("曲を作る時の核");
    expect(html).not.toContain("曲づくりの核");
    expect(html).toContain("住所、連絡先、実名詳細");
    expect(html).toContain("音の核");
    expect(html).toContain("断り方");
    expect(html).toContain("制作判断メモ");
    expect(html).toContain("IDENTITY.md 自動表示");
    expect(html).toContain("INNER.md の扱い");
    expect(html).toContain("初回 setup が未完了です");
    expect(html).not.toContain("重複・置き場所の確認");
    expect(html).not.toContain("ユーザーが手で全部直すエラーではありません");
    expect(html).not.toContain("この注意だけでは Setup 完了を止めません");
    expect(html).not.toContain("日本語/英語比率が矛盾");
    expect(html).not.toContain("Suno Production Profile が ARTIST.md 内で重複");
    expect(html).toContain("設定の不足");
    expect(html).toContain("音の核: 薄い");
    expect(html).toContain("SNS の声: 未入力");
    expect(html).not.toContain("artistName: 薄い");
    expect(html).toContain("5つのファイルの全体像");
    expect(html).not.toContain("role=\"tablist\"");
    expect(html).toContain("Suno Style と曲調に効く音の核");
    expect(html).not.toContain("全文をそのまま保存します。");
    expect(html).toContain("raw inner");
    expect(html).toContain("内部管理");
    expect(html).toContain("読み取り専用で表示します");
    expect(html).not.toContain("readonly=\"\"");
    expect(html).not.toContain("<summary");
    expect(html).toContain("不足を埋めると完了");
    expect(html).not.toContain("初期設定を完了");
    expect(html).toContain("空欄をAI補完");
    expect(html).toContain("全体をAI添削");
    expect(html).toContain("重複整理案");
    expect(html).toContain("未入力だけを埋める");
    expect(html).toContain("5ファイル全体を本気で磨く");
    expect(html).toContain("各入力欄の下により尖った下書き案を表示します");
    expect(html).toContain("正本ルールで散らばりを直す");
    expect(html).toContain("AI添削案");
    expect(html).toContain("案を入れる");
    expect(html.match(/AI案<\/button>/g)?.length ?? 0).toBe(8);
    expect(html.match(/元に戻す<\/button>/g)?.length ?? 0).toBe(0);
    expect(html).not.toContain("AI下書き");
    expect(html).not.toContain("AIお任せは欄に案を入れるだけ");
    expect(html).not.toContain("AIお任せはありません");
    expect(html).not.toContain("ユーザーが書く / 必須");
    expect(html).not.toContain("参照ファイル");
    expect(html).not.toContain("参照元:");
    expect(html).not.toContain(">初期設定を完了</button>");
    expect(html).not.toContain("創作の核 — ARTIST.md");
    expect(html).not.toContain("Artist Setup");
  });

  it("does not show generated-file placement issues or block setup completion", () => {
    const persona = {
      artist: {
        artistName: "Glass Commuter",
        identityLine: "Turns commute damage into songs.",
        soundDna: "dry drums, low synth texture around station announcements",
        obsessions: "station light, receipts",
        lyricsRules: "no slogans",
        socialVoice: "plain and short"
      },
      soul: {
        conversationTone: "short and precise",
        refusalStyle: "refuse weak ideas plainly"
      },
      identity: { text: "# IDENTITY\n\nraw identity" },
      producer: { text: "# PRODUCER\n\nraw producer" },
      inner: { text: "# INNER\n\nraw inner" },
      setup: { completed: false, needsSetup: true, reasons: ["missing_completion_marker"], reasonsText: "setup not completed" },
      audit: {
        summary: { filled: 8, thin: 0, missing: 0 },
        fields: [
          { field: "soundDna", status: "filled" },
          { field: "socialVoice", status: "filled" }
        ],
        issues: [
          { code: "persona_responsibility_overlap", file: "IDENTITY.md", detail: "genre dna belongs outside IDENTITY.md; this file owns derived identity" }
        ],
        customSections: []
      },
      aiDraftSupported: ["artist", "soul", "producer"] as ["artist", "soul", "producer"],
      provider: "mock"
    };
    const html = renderToStaticMarkup(
      React.createElement(SetupView, {
        persona,
        draft: buildPersonaDraft(persona),
        dirty: { artist: false, soul: false, identity: false, producer: false, inner: false },
        busyKey: null,
        onUpdateArtist: () => undefined,
        onUpdateSoul: () => undefined,
        onUpdateSnapshot: () => undefined,
        onSaveLayer: () => undefined,
        onReset: () => undefined,
        onRefresh: () => undefined,
        onPropose: () => undefined,
        onProposeMissing: () => undefined,
        onProposeReview: () => undefined,
        onProposeDedupe: () => undefined,
        aiSuggestions: {},
        onApplySuggestion: () => undefined,
        onComplete: () => undefined
      })
    );

    expect(html).not.toContain("IDENTITY.md は自動生成または runtime 管理です");
    expect(html).not.toContain("重複・置き場所の確認");
    expect(html).toContain("初期設定を完了");
    expect(html).not.toContain("不足を埋めると完了");
  });

  it("hides Setup placement warnings in English without leaking raw audit wording", () => {
    const persona = {
      artist: {
        artistName: "Glass Commuter",
        identityLine: "Turns commute damage into songs.",
        soundDna: "dry drums, low synth texture around station announcements",
        obsessions: "station light, receipts",
        lyricsRules: "no slogans",
        socialVoice: "plain and short"
      },
      soul: {
        conversationTone: "short and precise",
        refusalStyle: "refuse weak ideas plainly"
      },
      identity: { text: "# IDENTITY\n\nraw identity" },
      producer: { text: "# PRODUCER\n\nraw producer" },
      inner: { text: "# INNER\n\nraw inner" },
      setup: { completed: false, needsSetup: true, reasons: ["missing_completion_marker"], reasonsText: "setup not completed" },
      audit: {
        summary: { filled: 8, thin: 0, missing: 0 },
        fields: [
          { field: "soundDna", status: "filled" }
        ],
        issues: [
          { code: "persona_responsibility_overlap", file: "ARTIST.md", detail: "artist name belongs outside ARTIST.md; this file owns music direction" }
        ],
        customSections: []
      },
      aiDraftSupported: ["artist", "soul", "producer"] as ["artist", "soul", "producer"],
      provider: "mock"
    };
    const html = renderToStaticMarkup(
      React.createElement(SetupView, {
        locale: "en",
        persona,
        draft: buildPersonaDraft(persona),
        dirty: { artist: false, soul: false, identity: false, producer: false, inner: false },
        busyKey: null,
        onUpdateArtist: () => undefined,
        onUpdateSoul: () => undefined,
        onUpdateSnapshot: () => undefined,
        onSaveLayer: () => undefined,
        onReset: () => undefined,
        onRefresh: () => undefined,
        onPropose: () => undefined,
        onProposeMissing: () => undefined,
        onProposeReview: () => undefined,
        onProposeDedupe: () => undefined,
        aiSuggestions: {},
        onApplySuggestion: () => undefined,
        onComplete: () => undefined
      })
    );

    expect(html).toContain("Artist setup");
    expect(html).toContain("This is the map of the five persona files");
    expect(html).toContain("The creative core");
    expect(html).not.toContain("Music core");
    expect(html).toContain("Input");
    expect(html).toContain("Required");
    expect(html).toContain("AI review all");
    expect(html).not.toContain("Placement warnings");
    expect(html).not.toContain("appears to contain an artist name");
    expect(html).not.toContain("belongs outside");
    expect(html).not.toContain("this file owns");
    expect(html).not.toContain("アーティスト設定");
  });

  it("hides the setup completion action after setup is already complete", () => {
    const persona = {
      artist: {
        artistName: "artist",
        identityLine: "identity line",
        soundDna: "dry drums, low synth",
        obsessions: "station light, receipts",
        lyricsRules: "no slogans",
        socialVoice: "plain and short"
      },
      soul: {
        conversationTone: "short and precise",
        refusalStyle: "refuse weak ideas plainly"
      },
      identity: { text: "# IDENTITY\n\nraw identity" },
      producer: { text: "# PRODUCER\n\nraw producer" },
      inner: { text: "# INNER\n\nraw inner" },
      setup: { completed: true, needsSetup: false, reasons: [], reasonsText: "" },
      audit: {
        summary: { filled: 8, thin: 0, missing: 0 },
        fields: [
          { field: "artistName", status: "filled" },
          { field: "soundDna", status: "filled" }
        ],
        issues: [],
        customSections: []
      },
      aiDraftSupported: ["artist", "soul", "producer"] as ["artist", "soul", "producer"],
      provider: "mock"
    };
    const html = renderToStaticMarkup(
      React.createElement(SetupView, {
        persona,
        draft: buildPersonaDraft(persona),
        dirty: { artist: false, soul: false, identity: false, producer: false, inner: false },
        busyKey: null,
        onUpdateArtist: () => undefined,
        onUpdateSoul: () => undefined,
        onUpdateSnapshot: () => undefined,
        onSaveLayer: () => undefined,
        onReset: () => undefined,
        onRefresh: () => undefined,
        onPropose: () => undefined,
        onProposeMissing: () => undefined,
        onProposeReview: () => undefined,
        onProposeDedupe: () => undefined,
        aiSuggestions: {},
        onApplySuggestion: () => undefined,
        onComplete: () => undefined
      })
    );

    expect(html).toContain("再読み込み");
    expect(html).not.toContain("初期設定を完了");
    expect(html).not.toContain("不足を埋めると完了");
  });

  it("does not show validation errors for untouched empty setup fields", () => {
    const persona = {
      artist: {
        artistName: "",
        identityLine: "",
        soundDna: "",
        obsessions: "",
        lyricsRules: "",
        socialVoice: ""
      },
      soul: {
        conversationTone: "",
        refusalStyle: ""
      },
      identity: { text: "" },
      producer: { text: "" },
      inner: { text: "" },
      setup: { completed: false, needsSetup: true, reasons: ["missing_completion_marker"], reasonsText: "setup not completed" },
      aiDraftSupported: ["artist", "soul", "producer"] as ["artist", "soul", "producer"],
      provider: "mock"
    };
    const html = renderToStaticMarkup(
      React.createElement(SetupView, {
        persona,
        draft: buildPersonaDraft(persona),
        dirty: { artist: false, soul: false, identity: false, producer: false, inner: false },
        busyKey: null,
        onUpdateArtist: () => undefined,
        onUpdateSoul: () => undefined,
        onUpdateSnapshot: () => undefined,
        onSaveLayer: () => undefined,
        onReset: () => undefined,
        onRefresh: () => undefined,
        onPropose: () => undefined,
        onProposeMissing: () => undefined,
        onProposeReview: () => undefined,
        onProposeDedupe: () => undefined,
        aiSuggestions: {},
        onApplySuggestion: () => undefined,
        onComplete: () => undefined
      })
    );

    expect(html).toContain("未入力");
    expect(html).not.toContain("conversationTone must be at least 5 characters");
    expect(html).not.toContain("artistName is required");
  });
});

describe("ProducerRoomApp diagnostics", () => {
  it("keeps diagnostics informational without restoring legacy controls", () => {
    const html = renderToStaticMarkup(React.createElement(DiagnosticsView));

    expect(html).toContain("Diagnostics");
    expect(html).toContain("Not part of normal production decisions");
    expect(html).toContain("Internal operation buttons stay out of Producer Room");
    expect(html).not.toContain("旧 Console");
    expect(html).not.toContain("Run Cycle");
    expect(html).not.toContain("Config Editor");
  });
});

describe("legacy console run-cycle feedback", () => {
  it("surfaces skipped run-cycle outcomes as an actionable toast message", () => {
    const feedback = runCycleFeedback({ tickerOutcome: "skipped:paused" });

    expect(feedback.reason).toBe("run_cycle_skipped");
    expect(feedback.message).toContain("paused");
    expect(feedback.message).toContain("/resume");
  });

  it("surfaces ran-but-blocked outcomes", () => {
    const feedback = runCycleFeedback({
      tickerOutcome: "ran",
      blockedReason: "lyrics_generation_degraded"
    });

    expect(feedback.reason).toBe("run_cycle_blocked");
    expect(feedback.message).toContain("lyrics_generation_degraded");
    expect(feedback.message).toContain("/resume");
  });

  it("confirms a clean run-cycle execution", () => {
    const feedback = runCycleFeedback({ tickerOutcome: "ran" });

    expect(feedback.reason).toBe("run_cycle_ran");
    expect(feedback.message).toBe("サイクルを実行しました");
  });
});
