import { readCallbackActionEntries, resolveCallbackAction, markCallbackResolved, type CallbackActionEntry } from "./callbackActionRegistry.js";
import { getPollingWatchdogMinutes, resolveDefaultWorkspaceRoot } from "./runtimeConfig.js";
import { routeTelegramCallback } from "./telegramCallbackHandler.js";
import { TelegramClient, type TelegramSendMessageOptions } from "./telegramClient.js";
import type { TelegramReplyMarkup } from "../types.js";

const WATCHDOG_SCAN_INTERVAL_MS = 5 * 60 * 1000;

export interface CallbackPollingWatchdogResult {
  enabled: boolean;
  scanned: number;
  recovered: number;
  expired: number;
  skipped: number;
}

export interface CallbackPollingWatchdogOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
  client?: TelegramClient;
}

function createRecoveryTelegramClient(token?: string): TelegramClient {
  const liveClient = token?.trim() ? new TelegramClient(token.trim()) : null;
  return {
    answerCallbackQuery: async () => true,
    editMessageReplyMarkup: async (chatId: number | string, messageId: number, replyMarkup: TelegramReplyMarkup) =>
      liveClient ? liveClient.editMessageReplyMarkup(chatId, messageId, replyMarkup) : true,
    editMessageText: async (chatId: number | string, messageId: number, text: string, options?: TelegramSendMessageOptions) =>
      liveClient ? liveClient.editMessageText(chatId, messageId, text, options) : true,
    sendMessage: async (chatId: number | string, text: string, options?: TelegramSendMessageOptions) =>
      liveClient ? liveClient.sendMessage(chatId, text, options) : ({ message_id: 0, chat: { id: Number(chatId) } })
  } as unknown as TelegramClient;
}

function latestEntries(entries: CallbackActionEntry[]): CallbackActionEntry[] {
  return [...entries.reduce((map, entry) => map.set(entry.callbackId, entry), new Map<string, CallbackActionEntry>()).values()];
}

export async function runCallbackPollingWatchdogOnce(options: CallbackPollingWatchdogOptions = {}): Promise<CallbackPollingWatchdogResult> {
  const env = options.env ?? process.env;
  const staleMinutes = getPollingWatchdogMinutes(env);
  if (staleMinutes <= 0) {
    return { enabled: false, scanned: 0, recovered: 0, expired: 0, skipped: 0 };
  }

  const root = options.root ?? env.OPENCLAW_LOCAL_WORKSPACE?.trim() ?? resolveDefaultWorkspaceRoot();
  const now = options.now ?? Date.now();
  const client = options.client ?? createRecoveryTelegramClient(env.TELEGRAM_BOT_TOKEN);
  const entries = latestEntries(await readCallbackActionEntries(root));
  const staleMs = staleMinutes * 60 * 1000;
  const result: CallbackPollingWatchdogResult = {
    enabled: true,
    scanned: entries.length,
    recovered: 0,
    expired: 0,
    skipped: 0
  };

  for (const entry of entries) {
    const latest = await resolveCallbackAction(root, entry.callbackId);
    if (!latest || latest.status !== "pending") {
      result.skipped += 1;
      continue;
    }
    if (now > latest.expiresAt) {
      await markCallbackResolved(root, latest.callbackId, {
        status: "expired",
        reason: "polling_watchdog_expired",
        now
      });
      result.expired += 1;
      continue;
    }
    if (now - latest.createdAt < staleMs) {
      result.skipped += 1;
      continue;
    }

    const routed = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: `watchdog:${latest.callbackId}`,
      data: `cb:${latest.callbackId}`,
      fromUserId: latest.userId,
      chatId: latest.chatId,
      messageId: latest.messageId,
      now,
      actor: "watchdog_recovery",
      auditReason: "polling_watchdog_recovery"
    });
    if (routed.processed && routed.result !== "duplicate" && routed.result !== "ignored") {
      result.recovered += 1;
    } else {
      result.skipped += 1;
    }
  }

  return result;
}

export function startCallbackPollingWatchdog(env: NodeJS.ProcessEnv = process.env): () => void {
  if (getPollingWatchdogMinutes(env) <= 0) {
    return () => undefined;
  }
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runCallbackPollingWatchdogOnce({ env })
      .catch((error) => {
        console.warn("[artist-runtime] callback polling watchdog failed:", error);
      })
      .finally(() => {
        running = false;
      });
  };
  tick();
  const interval = setInterval(tick, WATCHDOG_SCAN_INTERVAL_MS);
  interval.unref();
  return () => clearInterval(interval);
}
