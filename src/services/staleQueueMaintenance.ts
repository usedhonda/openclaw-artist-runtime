import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SongState, SongStatus } from "../types.js";
import { listSongStates, readSongState, updateSongState } from "./artistState.js";
import { readCallbackActionEntries, type CallbackActionEntry } from "./callbackActionRegistry.js";

const staleQueueStatuses = new Set<SongStatus>(["brief", "lyrics", "suno_prompt_pack"]);
const terminalSongStatuses = new Set<SongStatus>(["scheduled", "published", "archived", "discarded", "failed"]);

export interface StaleQueueMaintenanceOptions {
  now?: Date;
  ttlHours?: number;
}

export interface StaleQueueCleanupEntry {
  songId: string;
  previousStatus: SongStatus;
  updatedAt: string;
  reason: string;
}

export interface CallbackLedgerInconsistency {
  callbackId: string;
  action: string;
  songId: string;
  status: string;
  reason: "callback_song_missing" | "pending_callback_terminal_song";
}

export interface StaleQueueMaintenanceResult {
  cleaned: StaleQueueCleanupEntry[];
  inconsistencies: CallbackLedgerInconsistency[];
  suppressedRestartStaleError?: string;
}

export function staleQueueCleanupAuditPath(root: string): string {
  return join(root, "runtime", "stale-queue-cleanup.jsonl");
}

function hoursMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

async function appendAudit(root: string, value: Record<string, unknown>): Promise<void> {
  const path = staleQueueCleanupAuditPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

function isStaleQueueSong(song: SongState, cutoffMs: number): boolean {
  if (!staleQueueStatuses.has(song.status)) {
    return false;
  }
  const updatedAt = Date.parse(song.updatedAt);
  return Number.isFinite(updatedAt) && updatedAt < cutoffMs;
}

function songById(songs: SongState[]): Map<string, SongState> {
  return new Map(songs.map((song) => [song.songId, song]));
}

function isCallbackRelevantToSong(entry: CallbackActionEntry): boolean {
  return Boolean(entry.songId) && (
    entry.action.startsWith("song_spawn_")
    || entry.action.startsWith("prompt_pack_")
    || entry.action.startsWith("song_")
    || entry.action.startsWith("dist_")
  );
}

function isRestartSunoStaleError(blockedReason?: string | null, lastError?: string | null): boolean {
  return /(?:playwright_import_no_urls|suno_generate_retry|suno_worker_not_connected|suno_import|waiting for Suno result import|suno_lifecycle_contract)/.test(
    `${blockedReason ?? ""}\n${lastError ?? ""}`
  );
}

export function detectCallbackLedgerInconsistencies(
  songs: SongState[],
  callbacks: CallbackActionEntry[]
): CallbackLedgerInconsistency[] {
  const songsById = songById(songs);
  const issues: CallbackLedgerInconsistency[] = [];
  for (const entry of callbacks) {
    if (!entry.songId || !isCallbackRelevantToSong(entry)) {
      continue;
    }
    const song = songsById.get(entry.songId);
    if (!song) {
      issues.push({
        callbackId: entry.callbackId,
        action: entry.action,
        songId: entry.songId,
        status: entry.status,
        reason: "callback_song_missing"
      });
      continue;
    }
    if (entry.status === "pending" && terminalSongStatuses.has(song.status)) {
      issues.push({
        callbackId: entry.callbackId,
        action: entry.action,
        songId: entry.songId,
        status: entry.status,
        reason: "pending_callback_terminal_song"
      });
    }
  }
  return issues;
}

export async function runStaleQueueMaintenance(
  root: string,
  options: StaleQueueMaintenanceOptions = {}
): Promise<StaleQueueMaintenanceResult> {
  const now = options.now ?? new Date();
  const ttlHours = options.ttlHours ?? 168;
  if (ttlHours <= 0) {
    return { cleaned: [], inconsistencies: [] };
  }
  const cutoffMs = now.getTime() - hoursMs(ttlHours);
  const songs = await listSongStates(root);
  const callbacks = await readCallbackActionEntries(root).catch(() => []);
  const cleaned: StaleQueueCleanupEntry[] = [];

  for (const song of songs) {
    if (!isStaleQueueSong(song, cutoffMs)) {
      continue;
    }
    const reason = `stale_queue_cleanup:${song.status}:older_than_${ttlHours}h`;
    await updateSongState(root, song.songId, {
      status: "archived",
      reason
    });
    const entry: StaleQueueCleanupEntry = {
      songId: song.songId,
      previousStatus: song.status,
      updatedAt: song.updatedAt,
      reason
    };
    cleaned.push(entry);
    await appendAudit(root, {
      timestamp: now.toISOString(),
      type: "stale_queue_archived",
      ...entry
    });
  }

  const freshSongs = cleaned.length > 0 ? await listSongStates(root) : songs;
  const inconsistencies = detectCallbackLedgerInconsistencies(freshSongs, callbacks);
  for (const issue of inconsistencies) {
    await appendAudit(root, {
      timestamp: now.toISOString(),
      type: "callback_ledger_inconsistency",
      ...issue
    });
  }

  return { cleaned, inconsistencies };
}

export async function suppressRestartStaleError(
  root: string,
  currentSongId: string | undefined,
  selectedSong: SongState | undefined,
  blockedReason?: string | null,
  lastError?: string | null
): Promise<string | undefined> {
  if (!currentSongId || (!blockedReason && !lastError)) {
    return undefined;
  }
  if (!isRestartSunoStaleError(blockedReason, lastError)) {
    return undefined;
  }
  if (selectedSong?.songId === currentSongId) {
    return undefined;
  }
  const previous = await readSongState(root, currentSongId).catch(() => undefined);
  const terminal = !previous || terminalSongStatuses.has(previous.status);
  if (!terminal) {
    return undefined;
  }
  return `restart_stale_error_suppressed:${currentSongId}:${previous?.status ?? "missing"}`;
}
