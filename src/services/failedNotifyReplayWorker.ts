import type { AiReviewProvider } from "../types.js";
import {
  appendFailedNotifyAgedOutRecord,
  appendFailedNotifyReplayRecord,
  type FailedNotifyEntry,
  isCriticalNotificationEvent,
  readFailedNotifyEntries
} from "./failedNotifyLedger.js";
import { TelegramNotifier, type TelegramNotifierOptions } from "./telegramNotifier.js";
import { emitRuntimeEvent, type RuntimeEvent } from "./runtimeEventBus.js";

export interface FailedNotifyReplayWorkerOptions {
  root: string;
  token: string;
  aiReviewProvider?: AiReviewProvider;
  dashboardBaseUrl?: string;
  fetchImpl?: TelegramNotifierOptions["fetchImpl"];
  intervalMs?: number;
  limit?: number;
  maxAgeMs?: number;
}

export interface FailedNotifyReplayResult {
  attempted: number;
  replayed: number;
  failed: number;
  agedOut: number;
  skipped: number;
  deliveryIds: string[];
}

const DEFAULT_REPLAY_INTERVAL_MS = 60 * 1000;
const DEFAULT_REPLAY_LIMIT = 10;
const DEFAULT_REPLAY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function latestByNotifyId(entries: FailedNotifyEntry[]): FailedNotifyEntry[] {
  const latest = new Map<string, FailedNotifyEntry>();
  for (const entry of entries) {
    latest.set(entry.notifyId, entry);
  }
  return [...latest.values()];
}

function deliveryIdFor(entry: FailedNotifyEntry): string {
  return entry.deliveryId ?? entry.notifyId;
}

function replayCandidates(entries: FailedNotifyEntry[], limit: number): FailedNotifyEntry[] {
  const seenDeliveryIds = new Set<string>();
  const candidates: FailedNotifyEntry[] = [];
  for (const entry of latestByNotifyId(entries)
    .filter((item) => item.status !== "replayed")
    .filter((item) => item.status !== "aged_out")
    .filter((item) => isCriticalNotificationEvent(item.eventPayload))
    .sort((left, right) => left.failedAt.localeCompare(right.failedAt))) {
    const deliveryId = deliveryIdFor(entry);
    if (seenDeliveryIds.has(deliveryId)) {
      continue;
    }
    seenDeliveryIds.add(deliveryId);
    candidates.push(entry);
    if (candidates.length >= limit) {
      break;
    }
  }
  return candidates;
}

function isAgedOut(entry: FailedNotifyEntry, now: Date, maxAgeMs: number): boolean {
  const failedAtMs = Date.parse(entry.failedAt);
  return Number.isFinite(failedAtMs) && now.getTime() - failedAtMs > maxAgeMs;
}

async function notifyEntry(options: FailedNotifyReplayWorkerOptions, entry: FailedNotifyEntry): Promise<void> {
  await new TelegramNotifier({
    token: options.token,
    chatId: entry.chatId,
    workspaceRoot: options.root,
    aiReviewProvider: options.aiReviewProvider,
    dashboardBaseUrl: options.dashboardBaseUrl,
    fetchImpl: options.fetchImpl
  }).notify(entry.eventPayload as RuntimeEvent);
}

export async function replayFailedNotificationsOnce(options: FailedNotifyReplayWorkerOptions): Promise<FailedNotifyReplayResult> {
  const entries = await readFailedNotifyEntries(options.root);
  const candidates = replayCandidates(entries, Math.max(1, options.limit ?? DEFAULT_REPLAY_LIMIT));
  const now = new Date();
  const maxAgeMs = Math.max(0, options.maxAgeMs ?? DEFAULT_REPLAY_MAX_AGE_MS);
  const result: FailedNotifyReplayResult = {
    attempted: 0,
    replayed: 0,
    failed: 0,
    agedOut: 0,
    skipped: 0,
    deliveryIds: []
  };
  for (const entry of candidates) {
    const deliveryId = deliveryIdFor(entry);
    result.deliveryIds.push(deliveryId);
    if (isAgedOut(entry, now, maxAgeMs)) {
      emitRuntimeEvent({
        type: "failed_notify_aged_out",
        notifyId: entry.notifyId,
        ...(entry.deliveryId ? { deliveryId: entry.deliveryId } : {}),
        eventType: entry.eventType,
        ...(entry.songId ? { songId: entry.songId } : {}),
        maxAgeMs,
        timestamp: now.getTime()
      });
      await appendFailedNotifyAgedOutRecord(options.root, entry, { maxAgeMs, now });
      result.agedOut += 1;
      continue;
    }
    result.attempted += 1;
    try {
      await notifyEntry(options, entry);
      await appendFailedNotifyReplayRecord(options.root, entry, { ok: true });
      result.replayed += 1;
    } catch (error) {
      await appendFailedNotifyReplayRecord(options.root, entry, { ok: false, error });
      result.failed += 1;
    }
  }
  result.skipped = Math.max(0, latestByNotifyId(entries)
    .filter((entry) => entry.status !== "replayed")
    .filter((entry) => entry.status !== "aged_out")
    .length - candidates.length);
  return result;
}

export function startFailedNotifyReplayWorker(options: FailedNotifyReplayWorkerOptions): () => void {
  let running = false;
  let stopped = false;
  const intervalMs = Math.max(1000, options.intervalMs ?? DEFAULT_REPLAY_INTERVAL_MS);

  const run = async () => {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      await replayFailedNotificationsOnce(options);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[failed-notify-replay] worker failed: ${reason}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref?.();
  void run();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
