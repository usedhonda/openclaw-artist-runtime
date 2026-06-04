import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCriticalNotificationEvent } from "../src/services/failedNotifyLedger";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { isTelegramSilentEvent, formatRuntimeEvent, TelegramNotifier } from "../src/services/telegramNotifier";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

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
    { type: "asset_generation_stalled", songId: "song-026", reason: "asset render failed", timestamp: 1 },
    { type: "artist_proactive_notice", trigger: "suno_trouble", message: "Suno に今つながってない、または timeout で詰まってる。整えて。", nextAction: "次: Suno 接続を整える。戻ったら自動で続きから確認する。", draftCount: 2, buildingCount: 1, songId: "song-026", title: "Matrix Jury", reason: "playwright_live_timeout", stateKey: "suno_trouble:song-026:playwright_live_timeout", timestamp: 1 }
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

  it("formats degraded lyrics as Japanese recovery text and attaches redraft/discard buttons", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-degraded-notify-"));
    const event: RuntimeEvent = {
      type: "lyrics_generation_degraded",
      songId: "song-lyrics",
      reason: "lyrics_generation_degraded: provider fallback response",
      detail: "provider fallback response",
      repairNotes: ["provider fallback response"],
      timestamp: 1
    };
    const text = await formatRuntimeEvent(event);
    expect(text).toContain("歌詞生成で止まった");
    expect(text).toContain("provider fallback response");
    expect(text).not.toContain("Lyrics generation degraded:");
    expect(text).toContain("歌詞を作り直す");
    expect(text).toContain("破棄");

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl }).notify(event);
    const entries = await readCallbackActionEntries(root);
    const markupCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    const markupBody = String((markupCall?.[1] as RequestInit).body);
    expect(entries.map((entry) => entry.action).sort()).toEqual(["lyrics_redraft", "song_discard"].sort());
    expect(markupBody).toContain("歌詞を作り直す");
    expect(markupBody).toContain("破棄");
  });
});
