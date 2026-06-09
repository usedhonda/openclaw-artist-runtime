import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// generateArtistResponse composes the artist-voice line via an AI call. Simulate it
// hanging (slow/unreachable provider): without a fail-fast guard this blocks notify()
// before sendMessage ever runs — a silent delivery wedge with no send/error/failed-notify.
vi.mock("../src/services/artistVoiceResponder.js", () => ({
  readArtistVoiceContext: vi.fn(async () => ({})),
  generateArtistResponse: vi.fn(() => new Promise(() => undefined))
}));

import { TelegramNotifier } from "../src/services/telegramNotifier";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

afterEach(() => {
  delete process.env.OPENCLAW_TELEGRAM_ARTIST_REPORT_TIMEOUT_MS;
  vi.restoreAllMocks();
});

describe("TelegramNotifier artistReport timeout", () => {
  it("delivers song_take_completed with deterministic fallback when the AI voice call hangs", async () => {
    process.env.OPENCLAW_TELEGRAM_ARTIST_REPORT_TIMEOUT_MS = "20";
    const root = mkdtempSync(join(tmpdir(), "notifier-artist-timeout-"));
    const sends: Array<{ chatId: unknown; text: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (url.includes("/sendMessage")) {
        sends.push({ chatId: body.chat_id, text: String(body.text ?? "") });
      }
      return jsonResponse({ ok: true, result: { message_id: 1, chat: { id: 123 }, text: "ok" } });
    });
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });

    const event: RuntimeEvent = {
      type: "song_take_completed",
      songId: "spawn_test",
      selectedTakeId: "take-1",
      urls: ["https://suno.com/song/abc"],
      timestamp: 1
    };

    // Must resolve quickly (well under the AI call, which never resolves) and still send.
    await Promise.race([
      notifier.notify(event),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("notify() hung past the fallback deadline")), 2_000))
    ]);

    expect(fetchImpl).toHaveBeenCalled();
    expect(sends).toHaveLength(1);
    expect(sends[0].chatId).toBe(123);
    expect(sends[0].text.length).toBeGreaterThan(0);
    // The selected take URL rides in the deterministic body even without the AI line.
    expect(sends[0].text).toContain("https://suno.com/song/abc");
  });
});
