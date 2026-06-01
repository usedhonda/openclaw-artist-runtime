import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService.js";
import { registerCallbackAction, resolveCallbackAction } from "../src/services/callbackActionRegistry.js";
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

describe("v10.30 watchdog no redispatch", () => {
  it("never calls callback answer/edit paths for stale prompt_pack_go", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-watchdog-no-redispatch-"));
    await ensureArtistWorkspace(root);
    await writeAutopilotRunState(root, {
      runId: "watchdog",
      currentSongId: "song-watchdog",
      stage: "prompt_pack",
      suspendedAt: "prompt_pack_ready",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: new Date(0).toISOString(),
      lastRunAt: new Date(0).toISOString(),
      lastSuccessfulStage: "prompt_pack"
    });
    const entry = await registerCallbackAction(root, {
      action: "prompt_pack_go",
      songId: "song-watchdog",
      chatId: 10,
      messageId: 20,
      userId: 30,
      now: 0
    });
    const telegram = client();

    const result = await runCallbackPollingWatchdogOnce({
      root,
      env: {
        OPENCLAW_POLLING_WATCHDOG_MINUTES: "10",
        OPENCLAW_PRODUCER_REMINDER_ENABLED: "on",
        OPENCLAW_PRODUCER_REMINDER_HOURS: "0.001"
      } as NodeJS.ProcessEnv,
      now: 11 * 60 * 1000,
      client: telegram
    });

    expect(result).toMatchObject({ recovered: 0, reminded: 1 });
    expect(telegram.answerCallbackQuery).not.toHaveBeenCalled();
    expect(telegram.editMessageText).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    await expect(resolveCallbackAction(root, entry.callbackId)).resolves.toMatchObject({ status: "pending" });
    await expect(readAutopilotRunState(root)).resolves.toMatchObject({ stage: "prompt_pack", suspendedAt: "prompt_pack_ready" });
  });
});
