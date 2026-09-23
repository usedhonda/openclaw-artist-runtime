import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readSongState } from "./artistState.js";
import { secretLikePattern } from "./personaMigrator.js";
import type { RuntimeEvent } from "./runtimeEventBus.js";

export type FailedNotifyStatus = "failed" | "replayed" | "replay_failed" | "aged_out";

export interface FailedNotifyEntry {
  notifyId: string;
  deliveryId?: string;
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
  deliveryId?: string;
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
  "suno_adoption_download_imported",
  "suno_adoption_download_failed",
  "lyrics_generation_degraded",
  "planning_skeleton_incomplete",
  "suno_create_failed",
  "suno_generate_retry",
  "suno_generate_failed",
  "suno_hard_stop",
  // A captcha human-assist alert must reach the producer even if Telegram is mid-connect
  // when it fires (boot race lost the 2026-07-28 spawn_cc1049 alert): make it replay-critical
  // so the worker re-delivers it until it lands (or the terminal-song skip retires it).
  "suno_human_assist_requested",
  "take_selection_stalled",
  "asset_generation_stalled",
  "producer_decision_reminder",
  "artist_proactive_notice",
  // A silent self-pause is exactly the 26h-blind-spot failure: make the "I paused myself"
  // alert replay-critical so it re-delivers if Telegram was mid-connect when it fired.
  "autopilot_auto_paused"
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
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`failed_notify_ledger_append_failed:${reason}`);
  }
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
    deliveryId: notifyIdFor(safeEvent, input.chatId),
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
    deliveryId: entry.deliveryId,
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
    .filter((entry) => entry.status !== "replayed")
    .filter((entry) => entry.status !== "aged_out")
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
    attempts: result.ok ? source.attempts : source.attempts + 1,
    replayedAt: (result.now ?? new Date()).toISOString(),
    replayError: result.ok ? undefined : ((result.error as Error)?.message ?? String(result.error))
  };
  return appendFailedNotifyEntry(root, entry);
}

export async function appendFailedNotifyAgedOutRecord(
  root: string,
  source: FailedNotifyEntry,
  input: { maxAgeMs: number; now?: Date }
): Promise<FailedNotifyEntry> {
  const entry: FailedNotifyEntry = {
    ...source,
    status: "aged_out",
    replayedAt: (input.now ?? new Date()).toISOString(),
    replayError: `failed_notify_replay_aged_out:${input.maxAgeMs}ms`
  };
  return appendFailedNotifyEntry(root, entry);
}

// A song that reached a terminal state (published/archived/discarded/failed) will never
// need its old notifications re-delivered. Replaying them re-surfaces stale take-completed
// notices forever (2026 song-018 zombie: an archived song's failed notify kept being
// re-emitted on every replay tick). Retire such entries as aged_out — reusing that terminal
// status means both the auto worker and the /replay command exclude them from future
// candidates — with a reason that records which terminal status stopped the replay.
export const TERMINAL_REPLAY_SONG_STATUSES: ReadonlySet<string> = new Set([
  "published",
  "archived",
  "discarded",
  "failed"
]);

export async function terminalReplaySongStatus(root: string, songId?: string): Promise<string | undefined> {
  if (!songId) {
    return undefined;
  }
  const song = await readSongState(root, songId).catch(() => undefined);
  return song && TERMINAL_REPLAY_SONG_STATUSES.has(song.status) ? song.status : undefined;
}

export async function appendFailedNotifyTerminalSkipRecord(
  root: string,
  source: FailedNotifyEntry,
  input: { songStatus: string; now?: Date }
): Promise<FailedNotifyEntry> {
  const entry: FailedNotifyEntry = {
    ...source,
    status: "aged_out",
    replayedAt: (input.now ?? new Date()).toISOString(),
    replayError: `failed_notify_replay_terminal_song:${input.songStatus}`
  };
  return appendFailedNotifyEntry(root, entry);
}

// Real Suno take ids are UUIDs. A take notification carrying a non-UUID id (the
// "take-1" placeholder song-018 held while stuck) or only "/song/take-N"
// placeholder urls is a synthetic/degenerate event that must never be
// re-delivered. Retiring it stops the resurface zombie during the window before
// the song reaches a terminal status (which the terminal-status skip covers).
const REAL_SUNO_TAKE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNTHETIC_TAKE_EVENTS: ReadonlySet<RuntimeEvent["type"]> = new Set(["song_take_completed", "suno_take_url_ready"]);

export function isSyntheticTakeNotification(event: RuntimeEvent): boolean {
  if (!SYNTHETIC_TAKE_EVENTS.has(event.type)) {
    return false;
  }
  const takeId = (event as { selectedTakeId?: string }).selectedTakeId;
  if (typeof takeId === "string" && takeId.length > 0 && !REAL_SUNO_TAKE_ID.test(takeId)) {
    return true;
  }
  const urls = (event as { urls?: unknown }).urls;
  return Array.isArray(urls) && urls.length > 0 && urls.every((url) => typeof url === "string" && /\/song\/take-\d+\b/.test(url));
}

export async function appendFailedNotifySyntheticSkipRecord(
  root: string,
  source: FailedNotifyEntry,
  input: { now?: Date } = {}
): Promise<FailedNotifyEntry> {
  const takeId = (source.eventPayload as { selectedTakeId?: string }).selectedTakeId ?? "unknown";
  const entry: FailedNotifyEntry = {
    ...source,
    status: "aged_out",
    replayedAt: (input.now ?? new Date()).toISOString(),
    replayError: `failed_notify_replay_synthetic_take:${takeId}`
  };
  return appendFailedNotifyEntry(root, entry);
}

// The notifier intentionally did not send this event on replay (dedup / digest
// off / non-signal). Retire it — retrying will not deliver it — but record it
// honestly as not-deliverable rather than a confirmed delivery.
export async function appendFailedNotifyNotDeliverableRecord(
  root: string,
  source: FailedNotifyEntry,
  input: { now?: Date } = {}
): Promise<FailedNotifyEntry> {
  const entry: FailedNotifyEntry = {
    ...source,
    status: "aged_out",
    replayedAt: (input.now ?? new Date()).toISOString(),
    replayError: "failed_notify_replay_not_deliverable"
  };
  return appendFailedNotifyEntry(root, entry);
}

// Replay kept failing to deliver up to the attempt cap; retire it so it stops
// retrying forever while recording that it was never confirmed delivered.
export async function appendFailedNotifyExhaustedRecord(
  root: string,
  source: FailedNotifyEntry,
  input: { attempts: number; now?: Date }
): Promise<FailedNotifyEntry> {
  const entry: FailedNotifyEntry = {
    ...source,
    status: "aged_out",
    replayedAt: (input.now ?? new Date()).toISOString(),
    replayError: `failed_notify_replay_exhausted:${input.attempts}`
  };
  return appendFailedNotifyEntry(root, entry);
}

// Count how many times replay has already failed to deliver this notification,
// so the worker can cap retries.
export function countReplayFailures(entries: FailedNotifyEntry[], notifyId: string): number {
  return entries.filter((entry) => entry.notifyId === notifyId && entry.status === "replay_failed").length;
}
