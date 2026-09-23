import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SongSpawnState } from "../types.js";

export function songSpawnStatePath(root: string): string {
  return join(root, "runtime", "song-spawn-state.json");
}

function logSongSpawnBackupFailure(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[song-spawn] backup failed: ${reason}`);
}

export async function readSongSpawnState(root: string): Promise<SongSpawnState> {
  const raw = await readFile(songSpawnStatePath(root), "utf8").catch(() => "");
  return raw ? JSON.parse(raw) as SongSpawnState : { updatedAt: new Date(0).toISOString() };
}

export async function shouldSpawn(root: string, options: { now?: Date; minIntervalHours?: number } = {}): Promise<boolean> {
  const state = await readSongSpawnState(root);
  if (!state.lastSpawnAt) {
    return true;
  }
  const now = options.now ?? new Date();
  const minIntervalMs = (options.minIntervalHours ?? 24) * 60 * 60 * 1000;
  return now.getTime() - new Date(state.lastSpawnAt).getTime() >= minIntervalMs;
}

export async function markSpawned(root: string, now = new Date()): Promise<SongSpawnState> {
  const path = songSpawnStatePath(root);
  await mkdir(dirname(path), { recursive: true });
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing) {
    await copyFile(path, `${path}.backup-${Date.now()}`).catch(logSongSpawnBackupFailure);
  }
  const next: SongSpawnState = {
    lastSpawnAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
  return next;
}
