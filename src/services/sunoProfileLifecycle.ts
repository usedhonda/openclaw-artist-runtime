import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_SUNO_PROFILE_STALE_DAYS = 30;
export const DEFAULT_SUNO_PROFILE_SNAPSHOT_KEEP = 7;
export const DEFAULT_SUNO_PROFILE_SNAPSHOT_RETENTION_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SunoProfileStaleReason = "missing" | "empty" | "stale" | "fresh";

export interface SunoProfileStaleStatus {
  profilePath: string;
  checkedAt: string;
  stale: boolean;
  reason: SunoProfileStaleReason;
  latestMtimeMs?: number;
  ageDays?: number;
  detail: string;
}

export interface SunoProfileSnapshot {
  name: string;
  path: string;
  mtimeMs: number;
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function defaultSunoProfileBackupRoot(profilePath: string): string {
  return `${profilePath.replace(/\/+$/, "")}.backup`;
}

async function latestMtimeMs(path: string): Promise<number | undefined> {
  const current = await stat(path).catch(() => undefined);
  if (!current) {
    return undefined;
  }

  if (!current.isDirectory()) {
    return current.mtimeMs;
  }

  let latest: number | undefined;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) {
      const childLatest = await latestMtimeMs(childPath);
      if (childLatest !== undefined) {
        latest = latest === undefined ? childLatest : Math.max(latest, childLatest);
      }
      continue;
    }

    const child = await stat(childPath).catch(() => undefined);
    if (child) {
      latest = latest === undefined ? child.mtimeMs : Math.max(latest, child.mtimeMs);
    }
  }

  return latest;
}

export async function detectStaleProfile(
  profilePath: string,
  ageDays = DEFAULT_SUNO_PROFILE_STALE_DAYS,
  now = new Date()
): Promise<SunoProfileStaleStatus> {
  const checkedAt = now.toISOString();
  const profile = await stat(profilePath).catch(() => undefined);
  if (!profile) {
    return {
      profilePath,
      checkedAt,
      stale: true,
      reason: "missing",
      detail: `Suno profile is missing at ${profilePath}`
    };
  }

  const latestMtime = await latestMtimeMs(profilePath);
  if (latestMtime === undefined) {
    return {
      profilePath,
      checkedAt,
      stale: true,
      reason: "empty",
      detail: `Suno profile has no readable entries at ${profilePath}`
    };
  }

  const age = Math.max(0, (now.getTime() - latestMtime) / MS_PER_DAY);
  const stale = age > ageDays;
  return {
    profilePath,
    checkedAt,
    stale,
    reason: stale ? "stale" : "fresh",
    latestMtimeMs: latestMtime,
    ageDays: age,
    detail: stale
      ? `Suno profile latest activity is ${age.toFixed(1)} days old; refresh login if probe fails`
      : `Suno profile latest activity is ${age.toFixed(1)} days old`
  };
}

export async function createSnapshot(
  profilePath: string,
  backupRoot = defaultSunoProfileBackupRoot(profilePath),
  now = new Date()
): Promise<SunoProfileSnapshot | undefined> {
  const profile = await stat(profilePath).catch(() => undefined);
  if (!profile?.isDirectory()) {
    return undefined;
  }

  const name = utcDate(now);
  const snapshotPath = join(backupRoot, name);
  await mkdir(backupRoot, { recursive: true });
  await rm(snapshotPath, { recursive: true, force: true });
  await cp(profilePath, snapshotPath, { recursive: true });
  const snapshot = await stat(snapshotPath);
  return { name, path: snapshotPath, mtimeMs: snapshot.mtimeMs };
}

export async function listSnapshots(backupRoot: string): Promise<SunoProfileSnapshot[]> {
  const entries = await readdir(backupRoot, { withFileTypes: true }).catch(() => []);
  const snapshots = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const snapshotPath = join(backupRoot, entry.name);
        const snapshot = await stat(snapshotPath);
        return { name: entry.name, path: snapshotPath, mtimeMs: snapshot.mtimeMs };
      })
  );
  return snapshots.sort((left, right) => left.name.localeCompare(right.name));
}

export async function pruneSnapshots(backupRoot: string, keepN = DEFAULT_SUNO_PROFILE_SNAPSHOT_KEEP): Promise<string[]> {
  const keep = Math.max(0, keepN);
  const snapshots = await listSnapshots(backupRoot);
  const remove = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  await Promise.all(remove.map((snapshot) => rm(snapshot.path, { recursive: true, force: true })));
  return remove.map((snapshot) => snapshot.name);
}

export async function pruneSnapshotsOlderThan(
  snapshotRoot: string,
  retentionDays = DEFAULT_SUNO_PROFILE_SNAPSHOT_RETENTION_DAYS,
  now = new Date()
): Promise<string[]> {
  const entries = await readdir(snapshotRoot, { withFileTypes: true }).catch(() => []);
  const cutoffMs = now.getTime() - Math.max(0, retentionDays) * MS_PER_DAY;
  const removed: string[] = [];
  for (const entry of entries) {
    const snapshotPath = join(snapshotRoot, entry.name);
    const snapshot = await stat(snapshotPath).catch(() => undefined);
    if (!snapshot || snapshot.mtimeMs >= cutoffMs) {
      continue;
    }
    await rm(snapshotPath, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed.sort((left, right) => left.localeCompare(right));
}
