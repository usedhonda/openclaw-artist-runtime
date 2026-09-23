import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SocialPublishLedgerEntry } from "../types.js";
import { inspectAuditLog } from "./auditLog.js";

const SOCIAL_LEDGER_FILE = "social-publish.jsonl";
const SOCIAL_LEDGER_ARCHIVE_FILE = "social-publish.archive.jsonl";
const DEFAULT_ROTATION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ledgerQueues = new Map<string, Promise<void>>();

function logSocialLedgerFailure(context: string, error: unknown): void {
  if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return;
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[social-publish-ledger] ${context} failed: ${reason}`);
}

export function getSocialLedgerPath(root: string, songId: string): string {
  return join(root, "songs", songId, "social", SOCIAL_LEDGER_FILE);
}

export function getSocialLedgerArchivePath(root: string, songId: string): string {
  return join(root, "songs", songId, "social", SOCIAL_LEDGER_ARCHIVE_FILE);
}

async function readJsonlEntries<T>(path: string): Promise<T[]> {
  const contents = await readFile(path, "utf8").catch(() => "");
  if (!contents) {
    return [];
  }
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function serializeJsonl<T>(entries: T[]): string {
  return entries.length > 0 ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
}

async function writeJsonlAtomic<T>(path: string, entries: T[]): Promise<void> {
  const tmpPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmpPath, serializeJsonl(entries), "utf8");
  await rename(tmpPath, path);
  await unlink(tmpPath).catch((error) => logSocialLedgerFailure("tmp cleanup after atomic write", error));
}

function shouldRotate(entry: SocialPublishLedgerEntry, cutoffMs: number): boolean {
  const timestamp = Date.parse(entry.timestamp);
  return Number.isFinite(timestamp) && timestamp < cutoffMs;
}

export async function appendSocialPublishLedgerEntry(
  root: string,
  songId: string,
  entry: SocialPublishLedgerEntry,
  options: { now?: Date; rotationDays?: number } = {}
): Promise<SocialPublishLedgerEntry> {
  const ledgerPath = getSocialLedgerPath(root, songId);
  await enqueueLedgerWrite(ledgerPath, () => appendSocialPublishLedgerEntryUnlocked(root, songId, entry, options));
  return entry;
}

export async function appendSocialReplyLedgerEntry(
  root: string,
  songId: string,
  entry: SocialPublishLedgerEntry,
  options: { now?: Date; rotationDays?: number } = {}
): Promise<SocialPublishLedgerEntry> {
  if (entry.action !== "reply" || entry.replyTarget?.type !== "reply") {
    throw new Error("reply ledger entries must include action=reply and replyTarget.type=reply");
  }
  return appendSocialPublishLedgerEntry(root, songId, entry, options);
}

async function enqueueLedgerWrite(path: string, task: () => Promise<void>): Promise<void> {
  const previous = ledgerQueues.get(path) ?? Promise.resolve();
  const current = previous.catch((error) => logSocialLedgerFailure("previous queued write", error)).then(task);
  ledgerQueues.set(path, current);
  try {
    await current;
  } finally {
    if (ledgerQueues.get(path) === current) {
      ledgerQueues.delete(path);
    }
  }
}

async function appendSocialPublishLedgerEntryUnlocked(
  root: string,
  songId: string,
  entry: SocialPublishLedgerEntry,
  options: { now?: Date; rotationDays?: number }
): Promise<void> {
  const ledgerPath = getSocialLedgerPath(root, songId);
  const archivePath = getSocialLedgerArchivePath(root, songId);
  await unlink(`${ledgerPath}.tmp`).catch((error) => logSocialLedgerFailure("stale ledger tmp cleanup", error));
  await unlink(`${archivePath}.tmp`).catch((error) => logSocialLedgerFailure("stale archive tmp cleanup", error));

  const health = await inspectAuditLog(ledgerPath);
  if (!health.healthy) {
    throw new Error(`jsonl file is unhealthy: ${health.errors.join("; ")}`);
  }

  const now = options.now ?? new Date();
  const rotationDays = options.rotationDays ?? DEFAULT_ROTATION_DAYS;
  const cutoffMs = now.getTime() - rotationDays * MS_PER_DAY;
  const current = await readJsonlEntries<SocialPublishLedgerEntry>(ledgerPath);
  const next = [...current, entry];
  const active = next.filter((candidate) => !shouldRotate(candidate, cutoffMs));
  const archived = next.filter((candidate) => shouldRotate(candidate, cutoffMs));

  if (archived.length > 0) {
    const existingArchive = await readJsonlEntries<SocialPublishLedgerEntry>(archivePath);
    await writeJsonlAtomic(archivePath, [...existingArchive, ...archived]);
  }
  await writeJsonlAtomic(ledgerPath, active);
}

export async function readLatestSocialPublishLedgerEntry(root: string, songId: string): Promise<SocialPublishLedgerEntry | undefined> {
  const entries = await readJsonlEntries<SocialPublishLedgerEntry>(getSocialLedgerPath(root, songId));
  return entries.at(-1);
}

export async function readSocialPublishLedgerEntries(root: string, songId: string): Promise<SocialPublishLedgerEntry[]> {
  return readJsonlEntries<SocialPublishLedgerEntry>(getSocialLedgerPath(root, songId));
}
