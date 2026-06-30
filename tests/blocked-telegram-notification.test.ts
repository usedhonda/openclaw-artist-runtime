import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTelegramSilentEvent, formatRuntimeEvent, TelegramNotifier } from "../src/services/telegramNotifier";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

describe("blocked runtime events Telegram delivery", () => {
  const planningSkeletonEvent: RuntimeEvent = {
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
  };
  const artistProactiveEvent: RuntimeEvent = {
    type: "artist_proactive_notice",
    trigger: "suno_trouble",
    message: "Suno に今つながってない、または timeout で詰まってる。整えて。",
    nextAction: "次: Suno 接続を整える。戻ったら自動で続きから確認する。",
    draftCount: 2,
    buildingCount: 1,
    songId: "song-026",
    title: "Matrix Jury",
    reason: "playwright_live_timeout",
    stateKey: "suno_trouble:song-026:playwright_live_timeout",
    timestamp: 1
  };
  const operationalEvents: RuntimeEvent[] = [
    { type: "suno_create_failed", songId: "song-026", reason: "playwright_live_timeout", retryCount: 1, timestamp: 1 },
    { type: "suno_generate_retry", songId: "song-026", reason: "suno_worker_not_ready", retryCount: 1, timestamp: 1 },
    { type: "suno_generate_failed", songId: "song-026", reason: "playwright_live_timeout", retryCount: 3, timestamp: 1 }
  ];
  const stalledEvents: RuntimeEvent[] = [
    { type: "take_selection_stalled", songId: "song-026", reason: "no imported takes", timestamp: 1 },
    { type: "asset_generation_stalled", songId: "song-026", reason: "asset render failed", timestamp: 1 }
  ];

  it("keeps operational blocked events silent in Telegram", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(telegramResponse({ message_id: 77, chat: { id: 123 } }));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });
    for (const event of operationalEvents) {
      expect(isTelegramSilentEvent(event), event.type).toBe(true);
      await notifier.notify(event);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends stalled operational information events without buttons", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(telegramResponse({ message_id: 77, chat: { id: 123 } })));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });
    for (const event of stalledEvents) {
      expect(isTelegramSilentEvent(event), event.type).toBe(false);
      await notifier.notify(event);
    }
    const sendCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/sendMessage"));
    const markupCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    expect(sendCalls).toHaveLength(2);
    expect(markupCalls).toHaveLength(0);
    const texts = sendCalls.map((call) => JSON.parse(String((call[1] as RequestInit).body)).text as string);
    expect(texts[0]).toContain("take 選別で止まっている");
    expect(texts[0]).not.toContain("ボタンで選ぶ");
    expect(texts[1]).toContain("素材作りで止まった");
    expect(texts[1]).not.toContain("ボタンで選ぶ");
  });

  it("keeps operational event formatters available for status and console surfaces", async () => {
    const texts = await Promise.all([...operationalEvents, ...stalledEvents].map((event) => formatRuntimeEvent(event)));
    expect(texts.join("\n")).not.toMatch(/Runtime error|Suno generate retry|Suno generate failed/);
    expect(texts.join("\n")).toContain("song-026");
    expect(texts.join("\n")).toContain("─────");
  });

  it("sends P4a producer-actionable events and mints buttons where supported", async () => {
    const lyricsEvent: RuntimeEvent = {
      type: "lyrics_generation_degraded",
      songId: "song-lyrics",
      reason: "lyrics_generation_degraded: provider fallback response",
      detail: "provider fallback response",
      repairNotes: ["provider fallback response"],
      timestamp: 1
    };
    const text = await formatRuntimeEvent(lyricsEvent);
    expect(text).toContain("歌詞生成で止まった");
    expect(text).toContain("provider fallback response");
    expect(text).not.toContain("Lyrics generation degraded:");
    expect(text).toContain("歌詞を作り直す");
    expect(text).toContain("破棄");

    const root = mkdtempSync(join(tmpdir(), "artist-runtime-degraded-notify-"));
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(telegramResponse({ message_id: 77, chat: { id: 123 } })));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });
    await notifier.notify(lyricsEvent);
    await notifier.notify(planningSkeletonEvent);
    await notifier.notify(artistProactiveEvent);

    const sendCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/sendMessage"));
    const markupCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    expect(sendCalls).toHaveLength(3);
    expect(markupCalls).toHaveLength(2);
    const actions = (await readCallbackActionEntries(root)).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining([
      "lyrics_redraft",
      "song_discard",
      "planning_skeleton_apply",
      "planning_skeleton_skip",
      "planning_skeleton_edit"
    ]));
    const sentTexts = sendCalls.map((call) => JSON.parse(String((call[1] as RequestInit).body)).text as string);
    expect(sentTexts.at(-1)).toContain("Suno に今つながってない");
    expect(sentTexts.at(-1)).not.toContain("ボタンで選ぶ");
  });

  it("sends actionable Suno hard-stops and keeps transient timeout/network silent", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(telegramResponse({ message_id: 77, chat: { id: 123 } })));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });
    await notifier.notify({ type: "suno_hard_stop", songId: "song-026", reason: "session_expired", timestamp: 1 });
    await notifier.notify({ type: "suno_hard_stop", songId: "song-026", reason: "session_expired", timestamp: 2 });
    await notifier.notify({ type: "suno_hard_stop", songId: "song-026", reason: "playwright_live_timeout", timestamp: 3 });
    await notifier.notify({ type: "error", source: "suno_worker", songId: "song-027", reason: "captcha_required", timestamp: 4 });
    await notifier.notify({ type: "error", source: "suno_worker", songId: "song-028", reason: "ECONNRESET", timestamp: 5 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const texts = fetchImpl.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)).text as string);
    expect(texts[0]).toContain("Suno のログインが切れた");
    expect(texts[0]).toContain("song-026");
    expect(texts[1]).toContain("Suno のログインが切れた");
    expect(texts[2]).toContain("CAPTCHA");
    expect(texts.join("\n")).not.toContain("playwright_live_timeout");
    expect(texts.join("\n")).not.toContain("ECONNRESET");
  });
});
