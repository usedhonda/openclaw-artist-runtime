import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
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

describe("v10.30 watchdog reprompt once", () => {
  it("sends one plain reprompt per callback id and keeps status pending", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-watchdog-reprompt-once-"));
    await ensureArtistWorkspace(root);
    const entry = await registerCallbackAction(root, {
      action: "proposal_yes",
      proposalId: "proposal-spawn",
      chatId: 10,
      messageId: 20,
      userId: 30,
      now: 0
    });
    const telegram = client();
    const env = { OPENCLAW_POLLING_WATCHDOG_MINUTES: "10" } as NodeJS.ProcessEnv;

    await expect(runCallbackPollingWatchdogOnce({ root, env, now: 11 * 60 * 1000, client: telegram })).resolves.toMatchObject({
      reprompted: 1,
      skipped: 0
    });
    await expect(runCallbackPollingWatchdogOnce({ root, env, now: 12 * 60 * 1000, client: telegram })).resolves.toMatchObject({
      reprompted: 0,
      skipped: 1
    });

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith(10, "⏰ 押し忘れの確認: proposal yes");
    await expect(resolveCallbackAction(root, entry.callbackId)).resolves.toMatchObject({ status: "pending" });
    const auditLines = (await readFile(join(root, "runtime", "callback-audit.jsonl"), "utf8")).trim().split("\n");
    expect(auditLines).toHaveLength(1);
    expect(JSON.parse(auditLines[0]) as Record<string, unknown>).toMatchObject({
      callbackId: entry.callbackId,
      actor: "watchdog_reprompt",
      reason: "polling_watchdog_reprompt"
    });
  });
});
