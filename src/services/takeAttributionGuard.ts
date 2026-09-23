import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditEvent } from "../types.js";
import { appendAuditLog, createAuditEvent } from "./auditLog.js";
import { listSongStates } from "./artistState.js";

export interface TakeAttributionCollision {
  takeId: string;
  url: string;
  songId: string;
  source: "public_links" | "latest_results";
}

export interface TakeAttributionSweepCollision extends TakeAttributionCollision {
  conflictingSongIds: string[];
}

interface LatestResults {
  urls?: string[];
}

function auditPath(root: string): string {
  return join(root, "runtime", "take-attribution-audit.jsonl");
}

export function extractSunoTakeId(url: string): string | undefined {
  const match = url.match(/https?:\/\/(?:www\.)?suno\.com\/song\/([^/?#]+)/i);
  return match?.[1];
}

export function findDryRunImportPaths(paths: string[] = []): string[] {
  return paths.filter((path) =>
    /(^|[/\\])runtime[/\\]suno-dryrun[/\\]/.test(path)
    || /(^|[/\\])suno-dryrun[/\\]/.test(path)
    || /(^|[/\\])[^/\\]+\.dryrun([/\\]|$)/.test(path)
  );
}

export async function appendTakeAttributionAudit(
  root: string,
  eventType: string,
  details: Record<string, unknown>
): Promise<AuditEvent> {
  return appendAuditLog(
    auditPath(root),
    createAuditEvent({
      eventType,
      actor: "system",
      verification: { status: "verified", detail: eventType },
      details
    })
  );
}

async function readLatestResultUrls(root: string, songId: string): Promise<string[]> {
  const path = join(root, "songs", songId, "suno", "latest-results.json");
  const contents = await readFile(path, "utf8").catch(() => "");
  if (!contents) {
    return [];
  }
  const parsed = JSON.parse(contents) as LatestResults;
  return parsed.urls?.filter(Boolean) ?? [];
}

export async function findTakeAttributionCollisions(
  root: string,
  currentSongId: string,
  urls: string[]
): Promise<TakeAttributionCollision[]> {
  const candidateIds = new Map<string, string>();
  for (const url of urls) {
    const takeId = extractSunoTakeId(url);
    if (takeId) {
      candidateIds.set(takeId, url);
    }
  }
  if (candidateIds.size === 0) {
    return [];
  }

  const collisions: TakeAttributionCollision[] = [];
  const seen = new Set<string>();
  const songs = await listSongStates(root);
  for (const song of songs) {
    if (song.songId === currentSongId) {
      continue;
    }
    for (const url of song.publicLinks) {
      const takeId = extractSunoTakeId(url);
      const candidateUrl = takeId ? candidateIds.get(takeId) : undefined;
      const key = candidateUrl ? `${song.songId}:public_links:${takeId}` : undefined;
      if (takeId && candidateUrl && key && !seen.has(key)) {
        seen.add(key);
        collisions.push({ takeId, url: candidateUrl, songId: song.songId, source: "public_links" });
      }
    }
    for (const url of await readLatestResultUrls(root, song.songId)) {
      const takeId = extractSunoTakeId(url);
      const candidateUrl = takeId ? candidateIds.get(takeId) : undefined;
      const key = candidateUrl ? `${song.songId}:latest_results:${takeId}` : undefined;
      if (takeId && candidateUrl && key && !seen.has(key)) {
        seen.add(key);
        collisions.push({ takeId, url: candidateUrl, songId: song.songId, source: "latest_results" });
      }
    }
  }
  return collisions;
}

export async function sweepTakeAttributionCollisions(root: string): Promise<TakeAttributionSweepCollision[]> {
  const owners = new Map<string, Array<{ songId: string; url: string; source: TakeAttributionCollision["source"] }>>();
  const songs = await listSongStates(root);
  for (const song of songs) {
    const urls = [
      ...song.publicLinks.map((url) => ({ url, source: "public_links" as const })),
      ...(await readLatestResultUrls(root, song.songId)).map((url) => ({ url, source: "latest_results" as const }))
    ];
    for (const entry of urls) {
      const takeId = extractSunoTakeId(entry.url);
      if (!takeId) {
        continue;
      }
      const bucket = owners.get(takeId) ?? [];
      bucket.push({ songId: song.songId, url: entry.url, source: entry.source });
      owners.set(takeId, bucket);
    }
  }

  const collisions: TakeAttributionSweepCollision[] = [];
  for (const [takeId, entries] of owners) {
    const songIds = Array.from(new Set(entries.map((entry) => entry.songId)));
    if (songIds.length < 2) {
      continue;
    }
    for (const entry of entries) {
      collisions.push({
        takeId,
        url: entry.url,
        songId: entry.songId,
        source: entry.source,
        conflictingSongIds: songIds.filter((songId) => songId !== entry.songId)
      });
    }
  }

  if (collisions.length > 0) {
    await appendTakeAttributionAudit(root, "take_attribution_collision_detected_sweep", {
      collisions
    });
  }
  return collisions;
}
