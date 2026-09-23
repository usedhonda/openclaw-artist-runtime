import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { callbackActionLedgerPath, readCallbackActionEntries, type CallbackActionEntry } from "./callbackActionRegistry.js";

export interface CallbackLedgerCleanupOptions {
  now?: () => Date;
  retentionMs?: number;
  rateLimit?: { minIntervalMs: number };
}

export interface CallbackLedgerCleanupResult {
  removed: number;
  kept: number;
  lastCleanupAt: string;
}

interface CleanupState {
  lastCleanupAt?: string;
}

const dayMs = 24 * 60 * 60 * 1000;
const defaultRetentionMs = 7 * dayMs;
const defaultMinIntervalMs = dayMs;

export function callbackCleanupStatePath(root: string): string {
  return join(root, "runtime", "callback-cleanup-state.json");
}

function backupPath(path: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${path}.backup-${stamp}`;
}

function serializeJsonl(entries: CallbackActionEntry[]): string {
  return entries.length > 0 ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
}

function logCallbackCleanupFailure(context: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[callback-ledger-maintenance] ${context} failed: ${reason}`);
}

async function readCleanupState(root: string): Promise<CleanupState> {
  const contents = await readFile(callbackCleanupStatePath(root), "utf8").catch(() => "");
  return contents ? JSON.parse(contents) as CleanupState : {};
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

async function writeJsonlAtomicWithBackup(path: string, entries: CallbackActionEntry[], now: Date): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing) {
    await copyFile(path, backupPath(path, now)).catch((error) => logCallbackCleanupFailure("backup", error));
  }
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, serializeJsonl(entries), "utf8");
  await rename(tmpPath, path);
}

function shouldRemoveEntry(entry: CallbackActionEntry, cutoffMs: number): boolean {
  return Number.isFinite(entry.expiresAt) && entry.expiresAt <= cutoffMs;
}

export async function cleanupExpiredCallbacks(
  root: string,
  options: CallbackLedgerCleanupOptions = {}
): Promise<CallbackLedgerCleanupResult> {
  const now = options.now?.() ?? new Date();
  const nowMs = now.getTime();
  const minIntervalMs = options.rateLimit?.minIntervalMs ?? defaultMinIntervalMs;
  const retentionMs = options.retentionMs ?? defaultRetentionMs;
  const state = await readCleanupState(root);
  const previousCleanupMs = state.lastCleanupAt ? Date.parse(state.lastCleanupAt) : Number.NaN;
  const entries = await readCallbackActionEntries(root);

  if (Number.isFinite(previousCleanupMs) && nowMs - previousCleanupMs < minIntervalMs) {
    return {
      removed: 0,
      kept: entries.length,
      lastCleanupAt: state.lastCleanupAt ?? now.toISOString()
    };
  }

  const cutoffMs = nowMs - retentionMs;
  const keptEntries = entries.filter((entry) => !shouldRemoveEntry(entry, cutoffMs));
  const removed = entries.length - keptEntries.length;

  if (removed > 0) {
    await writeJsonlAtomicWithBackup(callbackActionLedgerPath(root), keptEntries, now);
  }
  await writeJsonAtomic(callbackCleanupStatePath(root), { lastCleanupAt: now.toISOString() });

  return {
    removed,
    kept: keptEntries.length,
    lastCleanupAt: now.toISOString()
  };
}
