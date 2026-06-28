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
    currentLine: "今: 次の素案を探している",
    draftCount: 0,
    buildingCount: 0,
    nextAction: "次: 素案通知を待つ。",
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
          currentLine: "今: 手が空いている",
          draftCount: 2,
          nextAction: "次: 草稿箱から「作る」を押す。"
        })
      })
    );

    expect(html).toContain("現在地");
    expect(html).toContain("今");
    expect(html).toContain("今: 手が空いている");
    expect(html).toContain("状態");
    expect(html).toContain("健康");
    expect(html).toContain("Nothing needed");
    expect(html).not.toContain("<button");
  });

  it("renders exactly one resume CTA for paused states", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomHeader, {
        summary: summary({
          kind: "paused",
          currentLine: "今: autopilot は停止中",
          nextAction: "次: /resume で再開できる。",
          reason: "user_paused"
        }),
        onResume: () => undefined
      })
    );

    expect(html).toContain("状態");
    expect(html).toContain("詰まり");
    expect(html).toContain("理由");
    expect(html).toContain("user_paused");
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain("再開");
    expect(html).not.toContain("Resume");
  });

  it("renders reauth_required as guidance without a false fix button", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomHeader, {
        summary: summary({
          kind: "reauth_required",
          currentLine: "今: 歌詞AIのトークンが失効し制作が止まっている",
          nextAction: "次: 歌詞AIの再認証が必要。/resume では直りません",
          reason: "ai_provider_not_configured: 歌詞AIのトークン失効/未設定"
        })
      })
    );

    expect(html).toContain("要再認証");
    expect(html).toContain("歌詞AIの再認証が必要 (/resume では直りません)");
    expect(html).toContain("ai_provider_not_configured");
    expect(html).not.toContain("<button");
  });

  it("promotes pending producer decisions above the healthy empty state", () => {
    const promoted = roomSummaryWithDecisions(
      summary({
        kind: "empty",
        currentLine: "今: 次の素案を探している",
        nextAction: "次: 素案通知を待つ。"
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
    expect(html).toContain("判断待ち");
    expect(html).toContain("今: 二つの低気圧 の判断待ち");
    expect(html).toContain("Telegram の最新通知で 採用 / 破棄 を選ぶ");
    expect(html).toContain("完成後の採用待ち");
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

    expect(html).toContain("作品");
    expect(html).toContain("七万円のスクランブル");
    expect(html).toContain("制作 2 回");
    expect(html).toContain("試聴URLあり");
    expect(selectedIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeGreaterThan(selectedIndex);
    expect(nextSongIndex).toBeGreaterThan(detailIndex);
    expect(html).toContain("採用待ちの曲だけ同じ判断を出します");
    expect(html).not.toContain("← 作品へ");
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

    expect(html).toContain("1-5 / 12 曲");
    expect(html).toContain("Song 001");
    expect(html).toContain("Song 005");
    expect(html).toContain("制作 0 回");
    expect(html).toContain("採用済み");
    expect(html).toContain("採用待ち");
    expect(html).not.toContain("Song 006");
    expect(html).not.toContain("song-001 · run");
    expect(html).not.toContain("take-001");
    expect(html).not.toContain("take_selected");
    expect(html).not.toContain("archived");
  });

  it("renders steer settings and builds a config update patch from the draft", () => {
    const config = {
      artist: { artistId: "artist", workspaceRoot: "/tmp/artist" },
      music: { suno: { dailyCreditLimit: 4, monthlyCreditLimit: 40, driver: "mock" as const, submitMode: "skip" as const } },
      autopilot: { enabled: true, dryRun: true, songsPerWeek: 3, cycleIntervalMinutes: 60 },
      distribution: {
        liveGoArmed: false,
        platforms: {
          x: { enabled: true, liveGoArmed: false, authority: "draft_only" as const },
          instagram: { enabled: false, liveGoArmed: false, authority: "draft_only" as const },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" as const }
        }
      }
    };
    const draft = { ...buildConfigDraft(config), songsPerWeek: "5" };
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
    expect(html).toContain("自動制作");
    expect(html).toContain("Suno 予算");
    expect(html).toContain("配信先");
    expect(html).toContain("曲づくりの実行方法");
    expect(html).toContain("作成ボタン");
    expect(html).toContain("Instagram の扱い");
    expect(html).toContain("TikTok の扱い");
    expect(html).toContain("設定を保存");
    expect(html).toContain("凍結中");
    expect(html).toContain("下書きのみ");
    expect(html).not.toContain("/tmp/artist");
    expect(html).not.toContain("Live-Go Arm");
    expect(html).not.toContain("Suno Submit Mode");
    expect(html).not.toContain("Suno 操作方法");
    expect(html).not.toContain("Suno 送信");
    expect(html).not.toContain("Instagram 権限");
    expect(html).not.toContain("TikTok 権限");
    expect(html).not.toContain("workspace configured");
    expect(html).not.toContain("auto publish");
    expect(html).not.toContain(">mock<");
    expect(html).not.toContain(">skip<");
    expect(html).not.toContain("Save Settings");
    expect(html).not.toContain("Reset Draft");
  });

  it("renders the Setup tab editor with AI draft only on ARTIST/SOUL layers", () => {
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
      aiDraftSupported: ["artist", "soul"] as ["artist", "soul"],
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
        onComplete: () => undefined
      })
    );

    expect(html).toContain("アーティスト設定");
    expect(html).toContain("創作の核");
    expect(html).toContain("会話人格");
    expect(html).toContain("自己紹介");
    expect(html).toContain("初回 setup が未完了です");
    expect(html).toContain("設定の警告");
    expect(html).toContain("日本語/英語比率が矛盾");
    expect(html).toContain("Suno Production Profile が ARTIST.md 内で重複");
    expect(html).toContain("設定の不足");
    expect(html).toContain("音の核: 薄い");
    expect(html).toContain("SNS の声: 未入力");
    expect(html).toContain("曲づくりに効く人格だけを並べます。");
    expect(html).toContain("保存先: ARTIST.md");
    expect(html).toContain("保存先: SOUL.md");
    expect(html).toContain("Suno Style と曲調に効く音の核");
    expect(html).toContain("IDENTITY.md");
    expect(html).toContain("全文をそのまま保存します。");
    expect(html).toContain("不足を埋めると完了");
    expect(html).not.toContain("初期設定を完了");
    expect(html.match(/AIお任せ<\/button>/g)?.length ?? 0).toBe(0);
    expect(html.match(/元に戻す<\/button>/g)?.length ?? 0).toBe(0);
    expect(html).not.toContain("AI下書き");
    expect(html).not.toContain("AIお任せは欄に案を入れるだけ");
    expect(html).not.toContain("AIお任せはありません");
    expect(html).not.toContain("参照ファイル");
    expect(html).not.toContain("参照元:");
    expect(html).not.toContain("Setup 完了");
    expect(html).not.toContain("創作の核 — ARTIST.md");
    expect(html).not.toContain("Artist Setup");
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
      aiDraftSupported: ["artist", "soul"] as ["artist", "soul"],
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
      aiDraftSupported: ["artist", "soul"] as ["artist", "soul"],
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

    expect(html).toContain("診断");
    expect(html).toContain("通常の制作判断には使いません");
    expect(html).toContain("内部操作ボタンは Producer Room に戻しません");
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
