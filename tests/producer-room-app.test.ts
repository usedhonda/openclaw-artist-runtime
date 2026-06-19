import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it } from "vitest";
import { runCycleFeedback } from "../ui/src/App";
import { DiagnosticsView, RoomHeader, SettingsView, SongsView } from "../ui/src/ProducerRoomApp";
import { buildConfigDraft, buildConfigUpdatePatch } from "../ui/src/configEditor";
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

    expect(html).toContain("Artist is:");
    expect(html).toContain("今: 手が空いている");
    expect(html).toContain("Status:");
    expect(html).toContain("健康");
    expect(html).toContain("Nothing needed");
    expect(html).not.toContain("<button");
  });

  it("renders exactly one Resume CTA for paused states", () => {
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

    expect(html).toContain("Status:");
    expect(html).toContain("詰まり");
    expect(html).toContain("Why:");
    expect(html).toContain("user_paused");
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain("Resume");
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
});

describe("ProducerRoomApp Songs and Settings views", () => {
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
          }
        ]
      })
    );

    expect(html).toContain("Songs");
    expect(html).toContain("七万円のスクランブル");
    expect(html).toContain("suno_take_url_ready");
    expect(html).toContain("採用/破棄は Telegram の通知から");
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
    expect(html).toContain("Autopilot");
    expect(html).toContain("Suno Budget");
    expect(html).toContain("Platforms");
    expect(html).toContain("Save Settings");
    expect(html).toContain("frozen");
  });
});

describe("ProducerRoomApp diagnostics", () => {
  it("keeps the legacy console behind a lazy diagnostics boundary", () => {
    const html = renderToStaticMarkup(React.createElement(DiagnosticsView));

    expect(html).toContain("診断");
    expect(html).toContain("旧 Console");
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
