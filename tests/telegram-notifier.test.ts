import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  "次:",
  "ボタンで選ぶ"
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

  it("dedupes repeated self-heal notifications in the same window", async () => {
    vi.stubEnv("OPENCLAW_SELF_HEAL_NOTIFY", "on");
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: { message_id: 1, chat: { id: 123 } } }));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });
    await notifier.notify({ type: "error", source: "autopilot_ticker_stall", reason: "stale 12m", timestamp: 1 });
    await notifier.notify({ type: "error", source: "autopilot_ticker_stall", reason: "stale 12m", timestamp: 2 });
    await notifier.notify({ type: "error", source: "autopilot_ticker_stall", reason: "stale 18m", timestamp: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

  it("does not send non-signal runtime events through TelegramClient", async () => {
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

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors notifyStages=false for normal stage notifications", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const notifier = new TelegramNotifier({
      token: "token",
      chatId: 123,
      fetchImpl,
      notifyStages: false
    });

    await notifier.notify({
      type: "autopilot_stage_changed",
      songId: "song-001",
      from: "planning",
      to: "prompt_pack",
      timestamp: 1
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors producerDigest=off for normal signal notifications", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const notifier = new TelegramNotifier({
      token: "token",
      chatId: 123,
      fetchImpl,
      producerDigest: "off"
    });

    await notifier.notify({
      type: "prompt_pack_ready",
      songId: "song-001",
      title: "t",
      lyricsExcerpt: "l",
      mood: "m",
      tempo: "120 BPM",
      styleNotes: "s",
      timestamp: 2
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the four producer-room signal events and preserves inline buttons", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-signal-notify-"));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        message_id: 1,
        chat: { id: 123 },
        text: "ok"
      }
    }));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });
    const brief = { songId: "spawn-x", title: "t", brief: "b", lyricsTheme: "l", mood: "m", tempo: "120 BPM", duration: "2:30", styleNotes: "s", sourceText: "x", createdAt: "2026-05-06T00:00:00Z" };

    await notifier.notify({ type: "song_spawn_proposed", brief, reason: "ok", candidateSongId: "spawn-x", timestamp: 1 });
    await notifier.notify({ type: "prompt_pack_ready", songId: "song-001", title: "t", lyricsExcerpt: "l", mood: "m", tempo: "120 BPM", styleNotes: "s", timestamp: 2 });
    await notifier.notify({ type: "suno_take_url_ready", songId: "song-001", runId: "run-1", urls: ["https://suno.com/song/a"], timestamp: 3 });
    await notifier.notify({ type: "song_take_completed", songId: "song-001", urls: ["https://suno.com/song/a"], timestamp: 4 });

    const sendCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/sendMessage"));
    const markupCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    expect(sendCalls).toHaveLength(4);
    expect(markupCalls).toHaveLength(4);
    expect(markupCalls.map((call) => String((call[1] as RequestInit).body)).join("\n")).toContain("採用");
    expect(markupCalls.map((call) => String((call[1] as RequestInit).body)).join("\n")).toContain("破棄");
    expect(markupCalls.map((call) => String((call[1] as RequestInit).body)).join("\n")).toContain("作る");
    expect(markupCalls.map((call) => String((call[1] as RequestInit).body)).join("\n")).toContain("Suno 生成へ");
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

    bus.emit({ type: "song_take_completed", songId: "song-001", urls: ["https://suno.com/song/a"], timestamp: 1 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    unsubscribe();

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).text).toContain("song-001");
  });
});
