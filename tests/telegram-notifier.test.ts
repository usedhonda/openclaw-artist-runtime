import { describe, expect, it, vi } from "vitest";
import { RuntimeEventBus } from "../src/services/runtimeEventBus";
import { formatRuntimeEvent, TelegramNotifier } from "../src/services/telegramNotifier";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}

const songCompletionButtonEffects = [
  "",
  "─────",
  "次のボタン:",
  "- 採用: この曲を採用する。SNS には出さない。",
  "- 破棄: この曲を破棄する。brief は reuse のため残す。"
];

describe("TelegramNotifier", () => {
  it("surfaces self-heal events to Telegram when OPENCLAW_SELF_HEAL_NOTIFY=on (Plan v10.56 Phase 4)", async () => {
    vi.stubEnv("OPENCLAW_SELF_HEAL_NOTIFY", "on");
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: { message_id: 1, chat: { id: 123 } } }));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });
    await notifier.notify({ type: "error", source: "stale_queue_cleanup", reason: "older_than_168h", songId: "song-x", timestamp: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).text).toContain("自己修復");
    vi.unstubAllEnvs();
  });

  it("stays silent on self-heal events when the flag is off", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });
    await notifier.notify({ type: "error", source: "stale_queue_cleanup", reason: "x", timestamp: 1 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("formats stage events for Telegram", async () => {
    await expect(formatRuntimeEvent({
      type: "autopilot_stage_changed",
      songId: "song-001",
      from: "planning",
      to: "prompt_pack",
      timestamp: 1
    })).resolves.toBe("Autopilot stage: planning -> prompt_pack (song-001)");
  });

  it("formats completed Suno take URLs for private Telegram notification", async () => {
    await expect(formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-004",
      selectedTakeId: "take-2",
      urls: ["https://suno.com/song/a", "https://suno.com/song/b"],
      timestamp: 1
    })).resolves.toBe([
      "できた。song-004。聴いて、感想ほしい。",
      "",
      "─────",
      "🎵 song-004 (selected: take-2)",
      "完成しました。採用/破棄は後からで結構です。",
      "🔗 試聴:",
      "1. https://suno.com/song/a",
      "2. https://suno.com/song/b",
      "🎯 動機: 観察 summary なし",
      "🌐 観察元: (記録なし)",
      "💬 抜粋: (記録なし)",
      "非公開、御大のみ",
      ...songCompletionButtonEffects
    ].join("\n"));
  });

  it("formats a completed take without selectedTakeId", async () => {
    await expect(formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-004",
      urls: ["https://suno.com/song/a"],
      timestamp: 1
    })).resolves.toBe([
      "できた。song-004。聴いて、感想ほしい。",
      "",
      "─────",
      "🎵 song-004",
      "完成しました。採用/破棄は後からで結構です。",
      "🔗 試聴:",
      "1. https://suno.com/song/a",
      "🎯 動機: 観察 summary なし",
      "🌐 観察元: (記録なし)",
      "💬 抜粋: (記録なし)",
      "非公開、御大のみ",
      ...songCompletionButtonEffects
    ].join("\n"));
  });

  it("formats completed take notification when no URL is available", async () => {
    await expect(formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-004",
      selectedTakeId: "take-2",
      urls: [],
      timestamp: 1
    })).resolves.toContain("(URL なし)");
  });

  it("sends runtime events through TelegramClient with a mock fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        message_id: 1,
        chat: { id: 123 },
        text: "ok"
      }
    }));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });

    await notifier.notify({ type: "take_imported", songId: "song-001", paths: ["a.mp3"], metadata: [], timestamp: 1 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("/sendMessage");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({
      chat_id: 123,
      text: "Take imported: song-001 (1 path(s))"
    });
  });

  it("can subscribe to the runtime event bus", async () => {
    const bus = new RuntimeEventBus();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        message_id: 1,
        chat: { id: 123 },
        text: "ok"
      }
    }));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });
    const unsubscribe = notifier.subscribe(bus);

    bus.emit({ type: "take_imported", songId: "song-001", paths: ["a.mp3"], metadata: [], timestamp: 1 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    unsubscribe();

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).text).toContain("song-001");
  });
});
