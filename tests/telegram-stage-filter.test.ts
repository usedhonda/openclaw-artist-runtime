import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";
import {
  TelegramNotifier,
  isTelegramSilentEvent
} from "../src/services/telegramNotifier";

/**
 * Plan v10.12 Phase A:
 * Telegram is for human-relevant artist conversation only. Internal
 * autopilot telemetry (stage transitions, retries, debug errors) is
 * silenced at notify() so the producer console / event bus still see
 * the event but the chat does not.
 */

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}

const sendOk = (): Promise<Response> =>
  Promise.resolve(jsonResponse({
    ok: true,
    result: { message_id: 1, chat: { id: 123 }, text: "ok" }
  }));

const SILENT_EVENTS: RuntimeEvent[] = [
  { type: "observation_collected", entryCount: 0, timestamp: 1 },
  { type: "autopilot_stage_changed", songId: "song-001", from: "planning", to: "prompt_pack", timestamp: 1 },
  { type: "autopilot_state_changed", enabled: true, paused: false, timestamp: 1 },
  { type: "theme_generated", theme: "x", reason: "y", timestamp: 1 },
  { type: "autopilot_ticker_safe_recovery", outcome: "triggered", timestamp: 1 },
  { type: "theme_starvation", source: "observation_empty", details: "empty", timestamp: 1 },
  { type: "bird_cooldown_triggered", reason: "rate", cooldownUntil: "2026-05-06T00:00:00Z", timestamp: 1 },
  { type: "suno_take_url_ready", songId: "song-001", runId: "run-1", urls: ["https://suno.com/song/a"], timestamp: 1 },
  { type: "error", source: "autopilot", reason: "boom", timestamp: 1 }
];

describe("Telegram silent-event filter (Plan v10.12)", () => {
  it("classifies internal telemetry events as silent", () => {
    for (const event of SILENT_EVENTS) {
      expect(isTelegramSilentEvent(event)).toBe(true);
    }
  });

  it("does not classify human-relevant events as silent", () => {
    const noisy: RuntimeEvent[] = [
      { type: "song_take_completed", songId: "song-001", urls: ["https://suno.com/song/a"], timestamp: 1 },
      { type: "prompt_pack_ready", songId: "song-001", title: "t", lyricsExcerpt: "l", mood: "m", tempo: "120 BPM", styleNotes: "s", timestamp: 1 },
      { type: "suno_hard_stop", songId: "song-001", reason: "login_required", timestamp: 1 },
      { type: "error", source: "telegram_manual_song_create", reason: "ai_provider_not_configured", timestamp: 1 },
      { type: "error", source: "telegram_resume_run_now", reason: "ticker_run_failed", songId: "song-001", timestamp: 1 },
      { type: "song_spawn_proposed", brief: { songId: "spawn_x", title: "t", brief: "b", lyricsTheme: "l", mood: "m", tempo: "t", duration: "d", styleNotes: "s", sourceText: "x", createdAt: "2026-05-06T00:00:00Z" }, reason: "ok", candidateSongId: "spawn_x", timestamp: 1 }
    ];
    for (const event of noisy) {
      expect(isTelegramSilentEvent(event)).toBe(false);
    }
  });

  it("notify() skips Telegram sendMessage for silent events", async () => {
    const fetchImpl = vi.fn(sendOk);
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });

    for (const event of SILENT_EVENTS) {
      await notifier.notify(event);
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("notify() still sends Telegram for signal events", async () => {
    const fetchImpl = vi.fn(sendOk);
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });

    await notifier.notify({
      type: "song_take_completed",
      songId: "song-001",
      urls: ["https://suno.com/song/a"],
      timestamp: 1
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("/sendMessage");
  });

  it("notify() sends manual song create failures with recovery text", async () => {
    const fetchImpl = vi.fn(sendOk);
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });

    await notifier.notify({
      type: "error",
      source: "telegram_manual_song_create",
      reason: "ai_provider_not_configured",
      timestamp: 1
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)) as { text: string };
    expect(payload.text).toContain("曲作りの開始に失敗した");
    expect(payload.text).toContain("/status");
  });

  it("notify() sends resume immediate-cycle failures with recovery text", async () => {
    const fetchImpl = vi.fn(sendOk);
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, fetchImpl });

    await notifier.notify({
      type: "error",
      source: "telegram_resume_run_now",
      reason: "ticker_run_failed",
      songId: "song-001",
      timestamp: 1
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)) as { text: string };
    expect(payload.text).toContain("再開直後の続行に失敗した");
    expect(payload.text).toContain("song-001");
    expect(payload.text).toContain("/status");
  });
});
