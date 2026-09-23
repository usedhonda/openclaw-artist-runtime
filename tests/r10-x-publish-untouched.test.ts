import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState, updateSongState } from "../src/services/artistState";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { readResolvedConfig } from "../src/services/runtimeConfig";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import { hashXPostText } from "../src/services/xPublishActionRegistry";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-r10-x-"));
}

function callbackClient(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 99, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

function mockSpawn() {
  return ((_command: string, _args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    process.nextTick(() => {
      child.stdout.emit("data", "https://x.com/test_artist/status/1234567890");
      child.emit("close", 0);
    });
    return child;
  }) as never;
}

async function r10(root: string): Promise<Record<string, boolean>> {
  const config = await readResolvedConfig(root);
  return {
    dryRun: config.autopilot.dryRun,
    liveGoArmed: config.distribution.liveGoArmed,
    xLiveGoArmed: config.distribution.platforms.x.liveGoArmed
  };
}

describe("R10 X publish callback safety", () => {
  it("posts one X tweet and reflects SONGBOOK without changing dryRun or live arm flags", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "where-it-played", {
      title: "Where It Played",
      status: "take_selected",
      selectedTakeId: "take-1"
    });
    const before = await r10(root);
    const draftText = "できた。 https://suno.example/take-1";
    const confirm = await registerCallbackAction(root, {
      action: "x_publish_confirm",
      songId: "where-it-played",
      draftText,
      draftHash: hashXPostText(draftText),
      draftCharCount: 30,
      draftUrl: "https://suno.example/take-1",
      chatId: 123,
      messageId: 42,
      userId: 123
    });

    const result = await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "x-confirm",
      data: `cb:${confirm.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 42,
      xPublishSpawnImpl: mockSpawn()
    });

    expect(result).toMatchObject({ result: "applied", reason: "published" });
    expect(await r10(root)).toEqual(before);
    expect(await readSongState(root, "where-it-played")).toMatchObject({ status: "published" });
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toContain("https://x.com/test_artist/status/1234567890");
  });
});
