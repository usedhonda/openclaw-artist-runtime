// Persistence for the CreativeDecision spine. The plan is written once per song
// (songs/<id>/song-plan.json) at materialization and read by downstream stages.
// Write-once: if a plan already exists it is returned unchanged rather than
// overwritten, so a re-run never silently re-decides a song mid-flight.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CreativeDecision } from "../types.js";

export function songPlanPath(root: string, songId: string): string {
  return join(root, "songs", songId, "song-plan.json");
}

export async function readSongPlan(root: string, songId: string): Promise<CreativeDecision | undefined> {
  const raw = await readFile(songPlanPath(root, songId), "utf8").catch(() => "");
  if (!raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as CreativeDecision;
    return parsed && typeof parsed.songId === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Writes the plan only if none exists yet. Returns the persisted decision (the
// existing one when present, otherwise the one just written).
export async function writeSongPlan(root: string, decision: CreativeDecision): Promise<CreativeDecision> {
  const existing = await readSongPlan(root, decision.songId);
  if (existing) return existing;
  const path = songPlanPath(root, decision.songId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
  return decision;
}
