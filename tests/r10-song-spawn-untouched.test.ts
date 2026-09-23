import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { readResolvedConfig } from "../src/services/runtimeConfig";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import type { CommissionBrief } from "../src/types";

const originalSpawn = process.env.OPENCLAW_SONG_SPAWN_ENABLED;

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

function brief(): CommissionBrief {
  return {
    songId: "spawn_r10",
    title: "R10 Spawn",
    brief: "R10 boundary check song.",
    lyricsTheme: "safety boundary",
    mood: "observational",
    tempo: "artist decides",
    duration: "artist decides",
    styleNotes: "minimal",
    sourceText: "spawn test",
    createdAt: "2026-04-29T00:00:00.000Z"
  };
}

describe("R10 song spawn boundary", () => {
  afterEach(() => {
    if (originalSpawn === undefined) {
      delete process.env.OPENCLAW_SONG_SPAWN_ENABLED;
    } else {
      process.env.OPENCLAW_SONG_SPAWN_ENABLED = originalSpawn;
    }
    vi.restoreAllMocks();
  });

  it("injects an accepted spawn without changing dry-run or live arm flags", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-spawn-"));
    const before = await readResolvedConfig(root);
    const entry = await registerCallbackAction(root, {
      action: "song_spawn_inject",
      songId: "spawn_r10",
      commissionBrief: brief(),
      spawnReason: "test reason",
      chatId: 123,
      messageId: 77,
      userId: 123
    });

    const result = await routeTelegramCallback({
      root,
      client: client(),
      callbackQueryId: "spawn-r10",
      data: `cb:${entry.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    const after = await readResolvedConfig(root);

    expect(result).toMatchObject({ result: "applied" });
    expect(after.autopilot.dryRun).toBe(before.autopilot.dryRun);
    expect(after.autopilot.dryRun).toBe(true);
    expect(after.distribution.liveGoArmed).toBe(before.distribution.liveGoArmed);
    expect(after.distribution.platforms.x.liveGoArmed).toBe(before.distribution.platforms.x.liveGoArmed);
    expect(after.distribution.platforms.instagram.liveGoArmed).toBe(before.distribution.platforms.instagram.liveGoArmed);
    expect(after.distribution.platforms.tiktok.liveGoArmed).toBe(before.distribution.platforms.tiktok.liveGoArmed);
  });
});
