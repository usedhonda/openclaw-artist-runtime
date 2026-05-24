import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSongSkeleton } from "../repositories/songRepository.js";
import type { ObservationSummary, SongState, SongStateImportOutcome, SongStatus } from "../types.js";

const stateBlockStart = "<!-- artist-runtime:song-state:start -->";
const stateBlockEnd = "<!-- artist-runtime:song-state:end -->";
const defaultSongbook = [
  "# SONGBOOK.md",
  "",
  "Catalog of works.",
  "",
  "| Song ID | Title | Status | Suno Runs | Selected Take | Public Links |",
  "|---|---|---|---:|---|---|"
].join("\n");

export interface ArtistMindSnapshot {
  artist: string;
  currentState: string;
  socialVoice: string;
  songbook: string;
}

export interface SongStatePatch {
  status?: SongStatus;
  reason?: string;
  title?: string;
  briefPath?: string;
  lyricsVersion?: number;
  selectedTakeId?: string;
  clearSelectedTake?: boolean;
  appendPublicLinks?: string[];
  replacePublicLinks?: string[];
  runCountDelta?: number;
  lastImportOutcome?: SongStateImportOutcome;
  degradedLyrics?: boolean;
  observationSummary?: ObservationSummary;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultSongState(songId: string, title = songId): SongState {
  const timestamp = nowIso();
  return {
    songId,
    title,
    status: "idea",
    createdAt: timestamp,
    updatedAt: timestamp,
    publicLinks: [],
    runCount: 0
  };
}

function normalizeSongStatus(value?: string): SongStatus {
  switch (value) {
    case "idea":
    case "brief":
    case "lyrics":
    case "suno_prompt_pack":
    case "suno_running":
    case "takes_imported":
    case "take_selected":
    case "social_assets":
    case "publishing":
    case "scheduled":
    case "published":
    case "archived":
    case "discarded":
    case "failed":
      return value;
    case "drafting":
      return "idea";
    default:
      return "idea";
  }
}

function parseBulletedValue(lines: string[], label: string): string | undefined {
  const match = lines.find((line) => line.startsWith(`- ${label}: `));
  return match ? match.slice(label.length + 4).trim() : undefined;
}

function parsePublicLinks(lines: string[]): string[] {
  const startIndex = lines.findIndex((line) => line === "- Public Links:");
  if (startIndex === -1) {
    return [];
  }

  const links: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (!line.startsWith("  - ")) {
      break;
    }
    const value = line.slice(4).trim();
    if (value && value !== "(none)") {
      links.push(value);
    }
  }
  return links;
}

function parseImportOutcome(lines: string[]): SongStateImportOutcome | undefined {
  const raw = parseBulletedValue(lines, "Last Import Outcome");
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as SongStateImportOutcome;
    return typeof parsed.runId === "string" && Number.isFinite(parsed.urlCount) && typeof parsed.at === "string"
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function parseObservationSummary(lines: string[]): ObservationSummary | undefined {
  const raw = parseBulletedValue(lines, "Observation Summary");
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as ObservationSummary;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseSongState(contents: string, songId: string): SongState {
  const titleMatch = contents.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || songId;
  const blockMatch = contents.match(
    /<!-- artist-runtime:song-state:start -->([\s\S]*?)<!-- artist-runtime:song-state:end -->/
  );
  if (!blockMatch) {
    const legacyStatus = contents.match(/Status:\s*([A-Za-z0-9_-]+)/)?.[1];
    return {
      ...defaultSongState(songId, title),
      status: normalizeSongStatus(legacyStatus)
    };
  }

  const lines = blockMatch[1].split("\n").map((line) => line.trimEnd());
  const createdAt = parseBulletedValue(lines, "Created At") ?? nowIso();
  const updatedAt = parseBulletedValue(lines, "Updated At") ?? createdAt;
  const runCount = Number.parseInt(parseBulletedValue(lines, "Run Count") ?? "0", 10);
  const lyricsVersion = Number.parseInt(parseBulletedValue(lines, "Lyrics Version") ?? "", 10);

  return {
    songId: parseBulletedValue(lines, "Song ID") ?? songId,
    title,
    status: normalizeSongStatus(parseBulletedValue(lines, "Status")),
    createdAt,
    updatedAt,
    briefPath: parseBulletedValue(lines, "Brief Path") || undefined,
    lyricsVersion: Number.isFinite(lyricsVersion) ? lyricsVersion : undefined,
    selectedTakeId: parseBulletedValue(lines, "Selected Take") || undefined,
    publicLinks: parsePublicLinks(lines),
    runCount: Number.isFinite(runCount) ? runCount : 0,
    lastReason: parseBulletedValue(lines, "Last Reason") || undefined,
    lastImportOutcome: parseImportOutcome(lines),
    degradedLyrics: parseBulletedValue(lines, "Degraded Lyrics") === "true",
    observationSummary: parseObservationSummary(lines)
  };
}

function renderSongStateBlock(state: SongState): string {
  const linkLines = state.publicLinks.length > 0 ? state.publicLinks.map((link) => `  - ${link}`) : ["  - (none)"];
  return [
    stateBlockStart,
    `- Song ID: ${state.songId}`,
    `- Status: ${state.status}`,
    `- Created At: ${state.createdAt}`,
    `- Updated At: ${state.updatedAt}`,
    `- Brief Path: ${state.briefPath ?? ""}`,
    `- Lyrics Version: ${state.lyricsVersion ?? ""}`,
    `- Run Count: ${state.runCount}`,
    `- Selected Take: ${state.selectedTakeId ?? ""}`,
    "- Public Links:",
    ...linkLines,
    `- Last Reason: ${state.lastReason ?? ""}`,
    `- Last Import Outcome: ${state.lastImportOutcome ? JSON.stringify(state.lastImportOutcome) : ""}`,
    `- Degraded Lyrics: ${state.degradedLyrics ? "true" : "false"}`,
    `- Observation Summary: ${state.observationSummary ? JSON.stringify(state.observationSummary) : ""}`,
    stateBlockEnd
  ].join("\n");
}

function renderSongDocument(state: SongState, existing?: string): string {
  const titleHeading = `# ${state.title}`;
  const block = renderSongStateBlock(state);
  if (existing?.includes(stateBlockStart) && existing.includes(stateBlockEnd)) {
    const withHeading = existing.match(/^#\s+/m) ? existing.replace(/^#\s+.+$/m, titleHeading) : `${titleHeading}\n\n${existing}`;
    return withHeading.replace(
      /<!-- artist-runtime:song-state:start -->([\s\S]*?)<!-- artist-runtime:song-state:end -->/,
      block
    );
  }

  const notesSection = existing?.trim()
    ? existing
        .split("\n")
        .slice(1)
        .join("\n")
        .trim()
    : "## Notes\n\nPending artist notes.";

  return `${titleHeading}\n\n${block}\n\n${notesSection}\n`;
}

function songPath(root: string, songId: string): string {
  return join(root, "songs", songId, "song.md");
}

function songbookPath(root: string): string {
  return join(root, "artist", "SONGBOOK.md");
}

async function writeSongState(root: string, state: SongState): Promise<SongState> {
  await mkdir(join(root, "songs", state.songId), { recursive: true });
  const path = songPath(root, state.songId);
  const existing = await readFile(path, "utf8").catch(() => undefined);
  await writeFile(path, renderSongDocument(state, existing), "utf8");
  await syncSongbookRow(root, state);
  return state;
}

function renderSongbookRow(state: SongState): string {
  const publicLinks = state.publicLinks.length > 0 ? state.publicLinks.join("<br>") : "";
  return `| ${state.songId} | ${state.title} | ${state.status} | ${state.runCount} | ${state.selectedTakeId ?? ""} | ${publicLinks} |`;
}

export async function syncSongbookRow(root: string, state: SongState): Promise<void> {
  const path = songbookPath(root);
  const existing = await readFile(path, "utf8").catch(() => defaultSongbook);
  const lines = existing.trimEnd().split("\n");
  const row = renderSongbookRow(state);
  const rowIndex = lines.findIndex((line) => line.startsWith(`| ${state.songId} |`));

  if (rowIndex >= 0) {
    lines[rowIndex] = row;
  } else {
    lines.push(row);
  }

  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

export async function readArtistMind(root: string): Promise<ArtistMindSnapshot> {
  const [artist, currentState, socialVoice, songbook] = await Promise.all([
    readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
    readFile(join(root, "artist", "CURRENT_STATE.md"), "utf8").catch(() => ""),
    readFile(join(root, "artist", "SOCIAL_VOICE.md"), "utf8").catch(() => ""),
    readFile(songbookPath(root), "utf8").catch(() => defaultSongbook)
  ]);

  return { artist, currentState, socialVoice, songbook };
}

export async function readSongState(root: string, songId: string): Promise<SongState> {
  const path = songPath(root, songId);
  const contents = await readFile(path, "utf8").catch(() => "");
  if (!contents) {
    return defaultSongState(songId);
  }
  return parseSongState(contents, songId);
}

export async function listSongStates(root: string): Promise<SongState[]> {
  const songsRoot = join(root, "songs");
  const entries = await readdir(songsRoot, { withFileTypes: true }).catch(() => []);
  const states = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => readSongState(root, entry.name))
  );
  return states.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function ensureSongState(root: string, songId: string, title = songId): Promise<SongState> {
  await createSongSkeleton(root, songId);
  const current = await readSongState(root, songId);
  if (current.title === songId && title !== songId) {
    current.title = title;
  }
  return writeSongState(root, current);
}

export async function writeSongBrief(root: string, songId: string, briefText: string): Promise<SongState> {
  await createSongSkeleton(root, songId);
  const path = join(root, "songs", songId, "brief.md");
  await writeFile(path, `${briefText.trim()}\n`, "utf8");
  return updateSongState(root, songId, { status: "brief", briefPath: path, reason: "brief updated" });
}

export async function updateSongState(root: string, songId: string, patch: SongStatePatch): Promise<SongState> {
  await createSongSkeleton(root, songId);
  const current = await readSongState(root, songId);
  const publicLinks = new Set(current.publicLinks);
  for (const link of patch.appendPublicLinks ?? []) {
    if (link) {
      publicLinks.add(link);
    }
  }

  const next: SongState = {
    ...current,
    title: patch.title ?? current.title,
    status: patch.status ?? current.status,
    updatedAt: nowIso(),
    briefPath: patch.briefPath ?? current.briefPath,
    lyricsVersion: patch.lyricsVersion ?? current.lyricsVersion,
    selectedTakeId: patch.clearSelectedTake ? undefined : patch.selectedTakeId ?? current.selectedTakeId,
    publicLinks: patch.replacePublicLinks ? patch.replacePublicLinks.filter(Boolean) : Array.from(publicLinks),
    runCount: Math.max(0, current.runCount + (patch.runCountDelta ?? 0)),
    lastReason: patch.reason ?? current.lastReason,
    lastImportOutcome: patch.lastImportOutcome ?? current.lastImportOutcome,
    degradedLyrics: patch.degradedLyrics ?? current.degradedLyrics,
    observationSummary: patch.observationSummary ?? current.observationSummary
  };
  return writeSongState(root, next);
}
