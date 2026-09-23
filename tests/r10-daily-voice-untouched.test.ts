import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { readResolvedConfig } from "../src/services/runtimeConfig";
import type { TelegramClient } from "../src/services/telegramClient";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import { hashXPostText } from "../src/services/xPublishActionRegistry";

const originalPulse = process.env.OPENCLAW_ARTIST_PULSE_ENABLED;

function mockSpawn() {
  const responses = [
    { stdout: "@test_artist" },
    { stdout: "posted https://x.com/test_artist/status/1234567890" }
  ];
  return ((_command: string, _args: string[]) => {
    const result = responses.shift() ?? { stdout: "" };
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    process.nextTick(() => {
      child.stdout.emit("data", result.stdout);
      child.emit("close", 0);
    });
    return child;
  }) as never;
}

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

describe("R10 daily voice publish boundary", () => {
  afterEach(() => {
    if (originalPulse === undefined) {
      delete process.env.OPENCLAW_ARTIST_PULSE_ENABLED;
    } else {
      process.env.OPENCLAW_ARTIST_PULSE_ENABLED = originalPulse;
    }
    vi.restoreAllMocks();
  });

  it("publishes one daily voice tweet without changing dry-run or live arm flags", async () => {
    process.env.OPENCLAW_ARTIST_PULSE_ENABLED = "on";
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-daily-voice-"));
    const before = await readResolvedConfig(root);
    const draftText = "街の灯りが減ったぶん、影だけが少し正直になった。";
    const entry = await registerCallbackAction(root, {
      action: "daily_voice_publish",
      draftText,
      draftHash: hashXPostText(draftText),
      draftCharCount: Array.from(draftText).length,
      chatId: 123,
      messageId: 77,
      userId: 123
    });

    const result = await routeTelegramCallback({
      root,
      client: client(),
      callbackQueryId: "daily-r10",
      data: `cb:${entry.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77,
      xPublishSpawnImpl: mockSpawn()
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
