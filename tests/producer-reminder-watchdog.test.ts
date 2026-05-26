import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readCallbackActionEntries, registerCallbackAction, resolveCallbackAction } from "../src/services/callbackActionRegistry";
import { runCallbackPollingWatchdogOnce } from "../src/services/callbackPollingWatchdog";
import { failedNotifyLedgerPath } from "../src/services/failedNotifyLedger";
import type { TelegramClient } from "../src/services/telegramClient";

function client(fail = false): TelegramClient {
  return {
    answerCallbackQuery: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
    editMessageText: vi.fn(async () => true),
    sendMessage: vi.fn(async (chatId: number | string) => {
      if (fail) throw new Error("fetch failed");
      return { message_id: 0, chat: { id: Number(chatId) } };
    })
  } as unknown as TelegramClient;
}

async function seed(now: number): Promise<{ root: string; callbackId: string }> {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-producer-reminder-"));
  await ensureArtistWorkspace(root);
  const entry = await registerCallbackAction(root, {
    action: "song_archive",
    songId: "song-026",
    chatId: 123,
    messageId: 77,
    userId: 123,
    now
  });
  return { root, callbackId: entry.callbackId };
}

describe("producer decision reminder watchdog", () => {
  it("is opt-in and sends one reminder without resolving the callback", async () => {
    const { root, callbackId } = await seed(0);
    const telegram = client();
    const env = {
      OPENCLAW_POLLING_WATCHDOG_MINUTES: "0",
      OPENCLAW_PRODUCER_REMINDER_ENABLED: "on",
      OPENCLAW_PRODUCER_REMINDER_HOURS: "12"
    } as NodeJS.ProcessEnv;

    await expect(runCallbackPollingWatchdogOnce({ root, env, now: 13 * 60 * 60 * 1000, client: telegram })).resolves.toMatchObject({
      enabled: true,
      reminded: 1,
      reprompted: 0,
      recovered: 0
    });
    await expect(runCallbackPollingWatchdogOnce({ root, env, now: 14 * 60 * 60 * 1000, client: telegram })).resolves.toMatchObject({
      reminded: 0,
      skipped: 1
    });

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith(123, expect.stringContaining("判断待ちが残っている。"));
    await expect(resolveCallbackAction(root, callbackId)).resolves.toMatchObject({ status: "pending", reminderReason: "producer_decision_reminder" });
    const entries = await readCallbackActionEntries(root);
    expect(entries.at(-1)).toMatchObject({ callbackId, reminderSentAt: expect.any(Number) });
  });

  it("records failed reminder delivery in failed-notify ledger", async () => {
    const { root } = await seed(0);

    const result = await runCallbackPollingWatchdogOnce({
      root,
      env: {
        OPENCLAW_POLLING_WATCHDOG_MINUTES: "0",
        OPENCLAW_PRODUCER_REMINDER_ENABLED: "on",
        OPENCLAW_PRODUCER_REMINDER_HOURS: "12"
      } as NodeJS.ProcessEnv,
      now: 13 * 60 * 60 * 1000,
      client: client(true)
    });

    expect(result).toMatchObject({ reminded: 0, skipped: 1 });
    const failed = (await readFile(failedNotifyLedgerPath(root), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(failed[0]).toMatchObject({
      eventType: "producer_decision_reminder",
      songId: "song-026",
      status: "failed"
    });
  });
});
