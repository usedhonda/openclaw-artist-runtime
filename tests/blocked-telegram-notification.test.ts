import { describe, expect, it } from "vitest";
import { isCriticalNotificationEvent } from "../src/services/failedNotifyLedger";
import { isTelegramSilentEvent, formatRuntimeEvent } from "../src/services/telegramNotifier";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";

describe("blocked runtime events Telegram delivery", () => {
  const blockedEvents: RuntimeEvent[] = [
    {
      type: "planning_skeleton_incomplete",
      songId: "song-026",
      missing: ["tempo"],
      proposal: {
        id: "p1",
        domain: "song",
        summary: "tempo",
        fields: [],
        warnings: [],
        createdAt: "2026-05-25T00:00:00.000Z",
        source: "conversation",
        songId: "song-026"
      },
      timestamp: 1
    },
    { type: "suno_create_failed", songId: "song-026", reason: "playwright_live_timeout", retryCount: 1, timestamp: 1 },
    { type: "suno_generate_retry", songId: "song-026", reason: "suno_worker_not_ready", retryCount: 1, timestamp: 1 },
    { type: "suno_generate_failed", songId: "song-026", reason: "playwright_live_timeout", retryCount: 3, timestamp: 1 },
    { type: "suno_hard_stop", songId: "song-026", reason: "captcha", timestamp: 1 },
    { type: "take_selection_stalled", songId: "song-026", reason: "no imported takes", timestamp: 1 },
    { type: "asset_generation_stalled", songId: "song-026", reason: "asset render failed", timestamp: 1 }
  ];

  it("does not silence blocked events and records failed delivery for replay", () => {
    for (const event of blockedEvents) {
      expect(isTelegramSilentEvent(event), event.type).toBe(false);
      expect(isCriticalNotificationEvent(event), event.type).toBe(true);
    }
  });

  it("formats blocked events as producer-readable Japanese status", async () => {
    const texts = await Promise.all(blockedEvents.map((event) => formatRuntimeEvent(event)));
    expect(texts.join("\n")).not.toMatch(/Runtime error|Suno generate retry|Suno generate failed/);
    expect(texts.join("\n")).toContain("song-026");
    expect(texts.join("\n")).toContain("─────");
  });
});
