import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DebugAiReviewInput } from "../types.js";
import { readSongState } from "./artistState.js";
import { listSongTakes, readTakeHistory, type SongTakeReference } from "./takeSelection.js";

export interface SongMaterialHistory {
  priorRuns: Array<{
    runId: string;
    createdAt: string;
    urls: string[];
    takes: SongTakeReference[];
  }>;
  selectedTakeReferences: Awaited<ReturnType<typeof readTakeHistory>>;
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  const contents = await readFile(path, "utf8").catch(() => undefined);
  return contents?.trim() || undefined;
}

async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  const contents = await readTextIfExists(path);
  return contents ? JSON.parse(contents) : undefined;
}

async function readLatestLyrics(root: string, songId: string): Promise<string | undefined> {
  const lyricsRoot = join(root, "songs", songId, "lyrics");
  const entries = await readdir(lyricsRoot, { withFileTypes: true }).catch(() => []);
  const latest = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const version = entry.name.match(/^lyrics\.v(\d+)\.md$/)?.[1];
      return version ? { name: entry.name, version: Number.parseInt(version, 10) } : undefined;
    })
    .filter((entry): entry is { name: string; version: number } => entry !== undefined)
    .sort((left, right) => right.version - left.version)
    .at(0);
  return latest ? readTextIfExists(join(lyricsRoot, latest.name)) : undefined;
}

async function readPromptPackSummary(root: string, songId: string): Promise<unknown | undefined> {
  const promptsRoot = join(root, "songs", songId, "prompts");
  const promptDirs = await readdir(promptsRoot, { withFileTypes: true }).catch(() => []);
  const latestMetadata = promptDirs
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const version = entry.name.match(/^prompt-pack-v(\d+)$/)?.[1];
      return version ? { name: entry.name, version: Number.parseInt(version, 10) } : undefined;
    })
    .filter((entry): entry is { name: string; version: number } => entry !== undefined)
    .sort((left, right) => right.version - left.version)
    .at(0);
  if (latestMetadata) {
    return readJsonIfExists(join(promptsRoot, latestMetadata.name, "metadata.json"));
  }

  const sunoRoot = join(root, "songs", songId, "suno");
  const promptFiles = await readdir(sunoRoot, { withFileTypes: true }).catch(() => []);
  const latestPromptFile = promptFiles
    .filter((entry) => entry.isFile() && /^prompt-pack-.+\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  return latestPromptFile ? readJsonIfExists(join(sunoRoot, latestPromptFile)) : undefined;
}

function normalizeTakes(latestResults: unknown, fallback: unknown): unknown[] {
  if (Array.isArray(latestResults)) {
    return latestResults;
  }
  if (typeof latestResults === "object" && latestResults !== null && Array.isArray((latestResults as { takes?: unknown[] }).takes)) {
    return (latestResults as { takes: unknown[] }).takes;
  }
  return fallback ? [fallback] : [];
}

export async function readSongMaterial(root: string, songId: string): Promise<DebugAiReviewInput & SongMaterialHistory> {
  const songPath = join(root, "songs", songId, "song.md");
  await stat(songPath);
  const song = await readSongState(root, songId);
  const latestResults = await readJsonIfExists(join(root, "songs", songId, "suno", "latest-results.json"));
  const selectedTake = await readJsonIfExists(join(root, "songs", songId, "suno", "selected-take.json"));
  const [takeReferences, selectedTakeReferences] = await Promise.all([
    listSongTakes(root, songId),
    readTakeHistory(root, songId)
  ]);
  const priorRuns = Array.from(new Set(takeReferences.map((take) => take.runId))).map((runId) => {
    const takes = takeReferences.filter((take) => take.runId === runId);
    return {
      runId,
      createdAt: takes[0]?.createdAt ?? "",
      urls: takes.map((take) => take.url),
      takes
    };
  });
  const brief = await readTextIfExists(song.briefPath ?? join(root, "songs", songId, "brief.md"));
  const lyrics = await readLatestLyrics(root, songId);
  return {
    songId,
    title: song.title,
    brief,
    lyrics,
    takes: normalizeTakes(latestResults, selectedTake ?? song.lastImportOutcome),
    selectedTake,
    promptPackSummary: await readPromptPackSummary(root, songId),
    priorRuns,
    selectedTakeReferences
  };
}
