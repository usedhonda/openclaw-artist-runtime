import { hasCallbackReprompted, readCallbackActionEntries, resolveCallbackAction, markCallbackResolved, markCallbackReprompted, type CallbackActionEntry } from "./callbackActionRegistry.js";
import { getPollingWatchdogMinutes, isPollingWatchdogRepromptOnceEnabled, resolveDefaultWorkspaceRoot } from "./runtimeConfig.js";
import { TelegramClient, type TelegramSendMessageOptions } from "./telegramClient.js";
import type { TelegramReplyMarkup } from "../types.js";

const WATCHDOG_SCAN_INTERVAL_MS = 5 * 60 * 1000;

export interface CallbackPollingWatchdogResult {
  enabled: boolean;
  scanned: number;
  recovered: number;
  reprompted: number;
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

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    daily_voice_publish: "daily voice 投稿",
    daily_voice_edit: "daily voice 修正",
    daily_voice_cancel: "daily voice 取り消し",
    song_spawn_inject: "曲案の採用",
    song_spawn_skip: "曲案の見送り",
    song_spawn_edit: "曲案の修正",
    prompt_pack_go: "Suno に進める",
    prompt_pack_edit: "歌詞修正",
    prompt_pack_skip: "後で確認",
    planning_skeleton_apply: "骨組みを反映",
    planning_skeleton_skip: "骨組みを見送り",
    planning_skeleton_edit: "骨組みを修正",
    take_select_accept: "take 採用",
    take_select_regenerate: "take 再生成",
    take_select_skip: "take 見送り",
    x_publish_prepare: "X 投稿準備",
    x_publish_confirm: "X 投稿",
    x_publish_cancel: "X 投稿取り消し"
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

function hasResolvedSongSibling(entries: CallbackActionEntry[], entry: CallbackActionEntry): boolean {
  if (!entry.songId) return false;
  return entries.some((candidate) =>
    candidate.callbackId !== entry.callbackId
    && candidate.songId === entry.songId
    && (candidate.status === "applied" || candidate.status === "discarded" || candidate.status === "updated")
  );
}

export async function runCallbackPollingWatchdogOnce(options: CallbackPollingWatchdogOptions = {}): Promise<CallbackPollingWatchdogResult> {
  const env = options.env ?? process.env;
  const staleMinutes = getPollingWatchdogMinutes(env);
  if (staleMinutes <= 0) {
    return { enabled: false, scanned: 0, recovered: 0, reprompted: 0, expired: 0, skipped: 0 };
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
    reprompted: 0,
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
      await markCallbackReprompted(root, latest.callbackId, {
        now,
        actor: "watchdog_expire",
        reason: "polling_watchdog_expired"
      });
      result.expired += 1;
      continue;
    }
    if (now - latest.createdAt < staleMs) {
      result.skipped += 1;
      continue;
    }
    if (hasResolvedSongSibling(entries, latest) || await hasCallbackReprompted(root, latest.callbackId) || !isPollingWatchdogRepromptOnceEnabled(env)) {
      result.skipped += 1;
      continue;
    }

    await client.sendMessage(latest.chatId, `⏰ 押し忘れの確認: ${actionLabel(latest.action)}`);
    await markCallbackReprompted(root, latest.callbackId, {
      now,
      actor: "watchdog_reprompt",
      reason: "polling_watchdog_reprompt"
    });
    result.reprompted += 1;
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
