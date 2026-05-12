import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSongState } from "../src/services/artistState";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readAutopilotRunState } from "../src/services/autopilotService";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import { TelegramNotifier } from "../src/services/telegramNotifier";
import type { CommissionBrief } from "../src/types";

const originalSpawn = process.env.OPENCLAW_SONG_SPAWN_ENABLED;

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function callbackClient(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 99, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

function spawnBrief(songId = "spawn_e7c3b2"): CommissionBrief {
  return {
    songId,
    title: "静かな夜の勘定書",
    brief: "再開発の経済合理性を夜の街から見る。",
    lyricsTheme: "街が消える時の明細",
    mood: "late-night, observational, slight sarcasm",
    tempo: "128 BPM",
    duration: "4 分",
    styleNotes: "thick bass, restrained drum",
    sourceText: "autopilot spawn",
    createdAt: "2026-04-29T00:00:00.000Z"
  };
}

describe("telegram song spawn callback e2e", () => {
  afterEach(() => {
    if (originalSpawn === undefined) {
      delete process.env.OPENCLAW_SONG_SPAWN_ENABLED;
    } else {
      process.env.OPENCLAW_SONG_SPAWN_ENABLED = originalSpawn;
    }
    vi.restoreAllMocks();
  });

  it("pushes a spawn proposal and injects the accepted brief into autopilot planning", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-spawn-e2e-"));
    await ensureArtistWorkspace(root);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));

    await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl }).notify({
      type: "song_spawn_proposed",
      brief: spawnBrief(),
      reason: "observations align with SOUL mood and budget remains.",
      candidateSongId: "spawn_e7c3b2",
      voiceTop: "ゆずる、静かな夜の勘定書を切る。",
      timestamp: Date.parse("2026-04-29T00:00:00.000Z")
    });
    const entries = await readCallbackActionEntries(root);
    expect(entries.map((entry) => entry.action).sort()).toEqual(["song_spawn_edit", "song_spawn_inject", "song_spawn_skip"].sort());
    const markupCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    expect(String((markupCall?.[1] as RequestInit).body)).toContain("採用");

    const inject = entries.find((entry) => entry.action === "song_spawn_inject");
    const result = await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "spawn-inject",
      data: `cb:${inject?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    const state = await readAutopilotRunState(root);

    expect(result).toMatchObject({ result: "applied", reason: "song_spawn_injected" });
    expect(state).toMatchObject({ currentSongId: "spawn_e7c3b2", stage: "planning" });
    expect((await readSongState(root, "spawn_e7c3b2")).status).toBe("brief");
    expect(readFileSync(join(root, "songs", "spawn_e7c3b2", "brief.md"), "utf8")).toContain("Producer commission");
  });
});
