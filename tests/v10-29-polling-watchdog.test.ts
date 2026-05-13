import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService.js";
import { markCallbackResolved, readCallbackActionEntries, registerCallbackAction, resolveCallbackAction } from "../src/services/callbackActionRegistry.js";
import { runCallbackPollingWatchdogOnce } from "../src/services/callbackPollingWatchdog.js";
import type { TelegramClient } from "../src/services/telegramClient.js";

const staleEnv = { OPENCLAW_POLLING_WATCHDOG_MINUTES: "10" } as NodeJS.ProcessEnv;

function watchdogClient(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
    editMessageText: vi.fn(async () => true),
    sendMessage: vi.fn(async (chatId: number | string) => ({ message_id: 0, chat: { id: Number(chatId) } }))
  } as unknown as TelegramClient;
}

async function seedPending(now = 0, extra: { expiresAt?: number } = {}): Promise<{ root: string; callbackId: string }> {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-polling-watchdog-"));
  await ensureArtistWorkspace(root);
  await writeAutopilotRunState(root, {
    runId: "watchdog-run",
    currentSongId: "song-watchdog",
    stage: "prompt_pack",
    suspendedAt: "prompt_pack_ready",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date(now).toISOString(),
    lastRunAt: new Date(now).toISOString(),
    lastSuccessfulStage: "prompt_pack"
  });
  const entry = await registerCallbackAction(root, {
    action: "prompt_pack_go",
    songId: "song-watchdog",
    chatId: 123,
    messageId: 77,
    userId: 456,
    now,
    expiresAt: extra.expiresAt
  });
  return { root, callbackId: entry.callbackId };
}

describe("polling callback watchdog", () => {
  it("reprompts stale pending callbacks without dispatching state mutations", async () => {
    const { root, callbackId } = await seedPending(0);
    const client = watchdogClient();

    const result = await runCallbackPollingWatchdogOnce({
      root,
      env: staleEnv,
      now: 11 * 60 * 1000,
      client
    });

    expect(result).toMatchObject({ enabled: true, recovered: 0, reprompted: 1, expired: 0 });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "prompt_pack", suspendedAt: "prompt_pack_ready" });
    expect(client.sendMessage).toHaveBeenCalledWith(123, "⏰ 押し忘れの確認: Suno に進める");
    await expect(resolveCallbackAction(root, callbackId)).resolves.toMatchObject({
      status: "pending"
    });
    const audit = (await readFile(join(root, "runtime", "callback-audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(audit.at(-1)).toMatchObject({
      callbackId,
      action: "prompt_pack_go",
      actor: "watchdog_reprompt",
      reason: "polling_watchdog_reprompt",
      result: "reprompted"
    });
  });

  it("skips already-applied callbacks without creating duplicate resolutions", async () => {
    const { root, callbackId } = await seedPending(0);
    await markCallbackResolved(root, callbackId, { status: "applied", reason: "done", now: 100 });
    const before = await readCallbackActionEntries(root);

    const result = await runCallbackPollingWatchdogOnce({
      root,
      env: staleEnv,
      now: 11 * 60 * 1000,
      client: watchdogClient()
    });

    expect(result).toMatchObject({ recovered: 0, skipped: 1 });
    expect(await readCallbackActionEntries(root)).toHaveLength(before.length);
    await expect(resolveCallbackAction(root, callbackId)).resolves.toMatchObject({ status: "applied", resolveReason: "done" });
  });

  it("expires pending callbacks that are past expiresAt instead of dispatching them", async () => {
    const { root, callbackId } = await seedPending(0, { expiresAt: 1000 });

    const result = await runCallbackPollingWatchdogOnce({
      root,
      env: staleEnv,
      now: 2000,
      client: watchdogClient()
    });

    expect(result).toMatchObject({ recovered: 0, expired: 1 });
    await expect(resolveCallbackAction(root, callbackId)).resolves.toMatchObject({
      status: "expired",
      resolveReason: "polling_watchdog_expired"
    });
  });

  it("does nothing when OPENCLAW_POLLING_WATCHDOG_MINUTES is zero", async () => {
    const { root, callbackId } = await seedPending(0);

    const result = await runCallbackPollingWatchdogOnce({
      root,
      env: { OPENCLAW_POLLING_WATCHDOG_MINUTES: "0" } as NodeJS.ProcessEnv,
      now: 60 * 60 * 1000,
      client: watchdogClient()
    });

    expect(result).toMatchObject({ enabled: false, recovered: 0, expired: 0 });
    await expect(resolveCallbackAction(root, callbackId)).resolves.toMatchObject({ status: "pending" });
  });
});
