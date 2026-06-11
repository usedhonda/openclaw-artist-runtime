import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArtistPulseState } from "../types.js";

export function artistPulseStatePath(root: string): string {
  return join(root, "runtime", "artist-pulse-state.json");
}

function logArtistPulseBackupFailure(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[artist-pulse] backup failed: ${reason}`);
}

export async function readArtistPulseState(root: string): Promise<ArtistPulseState> {
  const raw = await readFile(artistPulseStatePath(root), "utf8").catch(() => "");
  if (!raw) {
    return { updatedAt: new Date(0).toISOString() };
  }
  return JSON.parse(raw) as ArtistPulseState;
}

export async function shouldPulse(root: string, options: { now?: Date; minIntervalHours?: number } = {}): Promise<boolean> {
  const state = await readArtistPulseState(root);
  if (!state.lastPulseAt) {
    return true;
  }
  const now = options.now ?? new Date();
  const minIntervalMs = (options.minIntervalHours ?? 12) * 60 * 60 * 1000;
  return now.getTime() - new Date(state.lastPulseAt).getTime() >= minIntervalMs;
}

export async function markPulsed(root: string, now = new Date()): Promise<ArtistPulseState> {
  const path = artistPulseStatePath(root);
  await mkdir(dirname(path), { recursive: true });
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing) {
    await copyFile(path, `${path}.backup-${Date.now()}`).catch(logArtistPulseBackupFailure);
  }
  const next: ArtistPulseState = {
    lastPulseAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
  return next;
}
