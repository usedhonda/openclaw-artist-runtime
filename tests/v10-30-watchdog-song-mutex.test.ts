import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { markCallbackResolved, registerCallbackAction, resolveCallbackAction } from "../src/services/callbackActionRegistry.js";
import { runCallbackPollingWatchdogOnce } from "../src/services/callbackPollingWatchdog.js";
import type { TelegramClient } from "../src/services/telegramClient.js";

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
    editMessageText: vi.fn(async () => true),
    sendMessage: vi.fn(async (chatId: number | string) => ({ message_id: 0, chat: { id: Number(chatId) } }))
  } as unknown as TelegramClient;
}

describe("v10.30 watchdog song mutex", () => {
  it("does not reprompt a stale callback when another callback for the same song already resolved", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-watchdog-song-mutex-"));
    await ensureArtistWorkspace(root);
    const inject = await registerCallbackAction(root, {
      action: "song_spawn_inject",
      proposalId: "spawn-1",
      songId: "song-shared",
      chatId: 10,
      messageId: 20,
      userId: 30,
      now: 0
    });
    const skip = await registerCallbackAction(root, {
      action: "song_spawn_skip",
      proposalId: "spawn-1",
      songId: "song-shared",
      chatId: 10,
      messageId: 20,
      userId: 30,
      now: 0
    });
    await markCallbackResolved(root, inject.callbackId, { status: "applied", reason: "song_spawn_injected", now: 1000 });
    const telegram = client();

    const result = await runCallbackPollingWatchdogOnce({
      root,
      env: { OPENCLAW_POLLING_WATCHDOG_MINUTES: "10" } as NodeJS.ProcessEnv,
      now: 11 * 60 * 1000,
      client: telegram
    });

    expect(result).toMatchObject({ reprompted: 0, skipped: 2 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    await expect(resolveCallbackAction(root, skip.callbackId)).resolves.toMatchObject({ status: "pending" });
  });
});
