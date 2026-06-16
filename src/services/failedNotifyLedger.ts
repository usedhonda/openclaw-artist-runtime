import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { secretLikePattern } from "./personaMigrator.js";
import type { RuntimeEvent } from "./runtimeEventBus.js";

export type FailedNotifyStatus = "failed" | "replayed" | "replay_failed";

export interface FailedNotifyEntry {
  notifyId: string;
  status: FailedNotifyStatus;
  eventType: RuntimeEvent["type"];
  songId?: string;
  chatId: string | number;
  eventPayload: RuntimeEvent;
  errorMessage: string;
  attempts: number;
  failedAt: string;
  replayedAt?: string;
  replayError?: string;
}

export interface FailedNotifySummaryEntry {
  notifyId: string;
  eventType: RuntimeEvent["type"];
  songId?: string;
  errorMessage: string;
  attempts: number;
  failedAt: string;
}

const CRITICAL_NOTIFY_EVENTS: ReadonlySet<RuntimeEvent["type"]> = new Set([
  "prompt_pack_ready",
  "song_spawn_proposed",
  "song_take_completed",
  "suno_take_url_ready",
  "lyrics_generation_degraded",
  "planning_skeleton_incomplete",
  "suno_create_failed",
  "suno_generate_retry",
  "suno_generate_failed",
  "suno_hard_stop",
  "take_selection_stalled",
  "asset_generation_stalled",
  "producer_decision_reminder",
  "artist_proactive_notice"
]);

export function failedNotifyLedgerPath(root: string): string {
  return join(root, "runtime", "failed-notify.jsonl");
}

export function isCriticalNotificationEvent(event: RuntimeEvent): boolean {
  return CRITICAL_NOTIFY_EVENTS.has(event.type);
}

function eventSongId(event: RuntimeEvent): string | undefined {
  if ("songId" in event && typeof event.songId === "string") return event.songId;
  if ("candidateSongId" in event && typeof event.candidateSongId === "string") return event.candidateSongId;
  return undefined;
}

function notifyIdFor(event: RuntimeEvent, chatId: string | number): string {
  return createHash("sha256")
    .update(JSON.stringify({ type: event.type, songId: eventSongId(event), timestamp: event.timestamp, chatId }))
    .digest("hex")
    .slice(0, 16);
}

function assertPayloadSafe(event: RuntimeEvent): RuntimeEvent {
  const payload = JSON.stringify(event);
  if (secretLikePattern.test(payload)) {
    throw new Error("failed_notify_payload_secret_like");
  }
  return JSON.parse(payload) as RuntimeEvent;
}

async function appendFailedNotifyEntry(root: string, entry: FailedNotifyEntry): Promise<FailedNotifyEntry> {
  const path = failedNotifyLedgerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function appendFailedNotification(
  root: string,
  input: {
    event: RuntimeEvent;
    chatId: string | number;
    error: unknown;
    attempts?: number;
    now?: Date;
  }
): Promise<FailedNotifyEntry | undefined> {
  if (!isCriticalNotificationEvent(input.event)) {
    return undefined;
  }
  const safeEvent = assertPayloadSafe(input.event);
  const entry: FailedNotifyEntry = {
    notifyId: notifyIdFor(safeEvent, input.chatId),
    status: "failed",
    eventType: safeEvent.type,
    songId: eventSongId(safeEvent),
    chatId: input.chatId,
    eventPayload: safeEvent,
    errorMessage: (input.error as Error)?.message ?? String(input.error),
    attempts: input.attempts ?? 1,
    failedAt: (input.now ?? new Date()).toISOString()
  };
  return appendFailedNotifyEntry(root, entry);
}

export async function readFailedNotifyEntries(root: string): Promise<FailedNotifyEntry[]> {
  const contents = await readFile(failedNotifyLedgerPath(root), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FailedNotifyEntry);
}

function latestByNotifyId(entries: FailedNotifyEntry[]): FailedNotifyEntry[] {
  const latest = new Map<string, FailedNotifyEntry>();
  for (const entry of entries) {
    latest.set(entry.notifyId, entry);
  }
  return [...latest.values()];
}

function summary(entry: FailedNotifyEntry): FailedNotifySummaryEntry {
  return {
    notifyId: entry.notifyId,
    eventType: entry.eventType,
    songId: entry.songId,
    errorMessage: entry.errorMessage,
    attempts: entry.attempts,
    failedAt: entry.failedAt
  };
}

export async function listUnreplayedFailedNotifications(
  root: string,
  options: { limit?: number; since?: string } = {}
): Promise<FailedNotifySummaryEntry[]> {
  const sinceMs = options.since ? Date.parse(options.since) : Number.NaN;
  const limit = Math.max(0, options.limit ?? 20);
  return latestByNotifyId(await readFailedNotifyEntries(root))
    .filter((entry) => entry.status === "failed")
    .filter((entry) => !Number.isFinite(sinceMs) || Date.parse(entry.failedAt) >= sinceMs)
    .sort((left, right) => right.failedAt.localeCompare(left.failedAt))
    .slice(0, limit)
    .map(summary);
}

export async function summarizeFailedNotifications(root: string, limit = 5): Promise<{ count: number; recent: FailedNotifySummaryEntry[] }> {
  const unreplayed = await listUnreplayedFailedNotifications(root, { limit: Number.MAX_SAFE_INTEGER });
  return {
    count: unreplayed.length,
    recent: unreplayed.slice(0, Math.max(0, limit))
  };
}

export async function latestFailedNotifyEntry(root: string, notifyId: string): Promise<FailedNotifyEntry | undefined> {
  const entries = await readFailedNotifyEntries(root);
  return entries.filter((entry) => entry.notifyId === notifyId).at(-1);
}

export async function appendFailedNotifyReplayRecord(
  root: string,
  source: FailedNotifyEntry,
  result: { ok: true; now?: Date } | { ok: false; error: unknown; now?: Date }
): Promise<FailedNotifyEntry> {
  const entry: FailedNotifyEntry = {
    ...source,
    status: result.ok ? "replayed" : "replay_failed",
    replayedAt: (result.now ?? new Date()).toISOString(),
    replayError: result.ok ? undefined : ((result.error as Error)?.message ?? String(result.error))
  };
  return appendFailedNotifyEntry(root, entry);
}
