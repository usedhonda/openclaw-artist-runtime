import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ArtistRuntimeConfig, ObservationSummary, SongIdeaResult } from "../types.js";
import { ensureSongState, readArtistMind, updateSongState, writeSongBrief } from "./artistState.js";
import { ensureArtistWorkspace } from "./artistWorkspace.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";

function titleCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function firstBulletSection(source: string, header: string): string[] {
  const lines = source.split("\n");
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === header.toLowerCase());
  if (startIndex === -1) {
    return [];
  }

  const values: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      values.push(trimmed.slice(2).trim());
    }
  }
  return values;
}

async function nextSongNumber(root: string): Promise<number> {
  const entries = await readdir(join(root, "songs"), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).length + 1;
}

function chooseTheme(artist: string, currentState: string): string {
  const obsessions = firstBulletSection(currentState, "## Current Obsessions");
  if (obsessions.length > 0) {
    return obsessions[0];
  }
  const core = firstBulletSection(artist, "## Current Artist Core");
  if (core.length > 0) {
    return core[0];
  }
  return "signal in the ruins";
}

function buildTitle(theme: string, index: number): string {
  const themed = titleCase(theme);
  return themed || `Song ${String(index).padStart(3, "0")}`;
}

function excerpt(value?: string): string {
  return (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 6).join("\n").slice(0, 900);
}

function observationRef(root: string, observationPath?: string): string | undefined {
  if (!observationPath) {
    return undefined;
  }
  const rel = relative(root, observationPath);
  return rel && !rel.startsWith("..") ? rel : observationPath;
}

function parseObservationField(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "none") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return trimmed.replace(/^["']|["']$/g, "");
  }
}

export function extractObservationSummary(observationText?: string, motivation?: string): ObservationSummary | undefined {
  const source = observationText?.trim();
  if (!source) {
    return undefined;
  }
  const text = source.match(/^-\s+text:\s*(.+)$/m)?.[1];
  const author = source.match(/^\s+author:\s*(.+)$/m)?.[1];
  const url = source.match(/^\s+url:\s*(.+)$/m)?.[1];
  const quote = parseObservationField(text ?? "") ?? excerpt(source).replace(/\s+/g, " ");
  return {
    author: parseObservationField(author ?? ""),
    url: parseObservationField(url ?? ""),
    quote,
    motivation: motivation?.trim() || "observation matched the artist direction"
  };
}

function buildBrief(title: string, theme: string, artistReason: string, observationText?: string, observationPath?: string): string {
  const lines = [
    `# Brief for ${title}`,
    "",
    "## Why this song exists",
    "",
    `A public-facing song grown from ${theme}.`,
    "",
    "## Direction",
    "",
    `- Core theme: ${theme}`,
    `- Artist reason: ${artistReason}`,
    "- Mood: cold, observant, quietly obsessive",
    "- Keep the images concrete and the chorus short"
  ];
  const observation = excerpt(observationText);
  if (observation) {
    const summary = extractObservationSummary(observationText, artistReason);
    lines.push(
      "",
      "## Observation source",
      "",
      `- Path: ${observationPath ?? "(runtime observation)"}`,
      `- Author: ${summary?.author ?? "unknown"}`,
      `- URL: ${summary?.url ?? ""}`,
      `- Quote: ${summary?.quote ?? observation.replace(/\s+/g, " ")}`,
      `- Motivation: ${summary?.motivation ?? artistReason}`,
      "- Extract:",
      observation
    );
  }
  return lines.join("\n");
}

export interface CreateSongIdeaInput {
  workspaceRoot: string;
  config?: Partial<ArtistRuntimeConfig>;
  title?: string;
  artistReason?: string;
  theme?: string;
  observationText?: string;
  observationPath?: string;
}

export async function createSongIdea(input: CreateSongIdeaInput): Promise<SongIdeaResult> {
  await ensureArtistWorkspace(input.workspaceRoot);
  const artistMind = await readArtistMind(input.workspaceRoot);
  const sequence = await nextSongNumber(input.workspaceRoot);
  const theme = input.theme?.trim() || chooseTheme(artistMind.artist, artistMind.currentState);
  const title = input.title?.trim() || buildTitle(theme, sequence);
  const songId = `song-${String(sequence).padStart(3, "0")}`;
  const artistReason = input.artistReason ?? `caught on ${theme}`;
  const briefText = buildBrief(title, theme, artistReason, input.observationText, input.observationPath);
  const observationSummary = extractObservationSummary(input.observationText, artistReason);
  const observationInputRef = input.observationText?.trim() ? observationRef(input.workspaceRoot, input.observationPath) : undefined;
  const inputRefs = ["ARTIST.md", "artist/CURRENT_STATE.md", observationInputRef].filter(Boolean) as string[];

  await ensureSongState(input.workspaceRoot, songId, title);
  const state = await writeSongBrief(input.workspaceRoot, songId, briefText);
  await updateSongState(input.workspaceRoot, songId, {
    title,
    status: "brief",
    reason: artistReason,
    observationSummary
  });

  const ledgerPath = getSongPromptLedgerPath(input.workspaceRoot, songId);
  const ideationEntry = await appendPromptLedger(
    ledgerPath,
    createPromptLedgerEntry({
      stage: "song_ideation",
      songId,
      actor: "artist",
      artistReason,
      inputRefs,
      outputRefs: [join(input.workspaceRoot, "songs", songId, "song.md")],
      outputSummary: title
    })
  );
  const briefEntry = await appendPromptLedger(
    ledgerPath,
    createPromptLedgerEntry({
      stage: "song_brief_creation",
      songId,
      actor: "artist",
      artistReason,
      inputRefs,
      outputRefs: [join(input.workspaceRoot, "songs", songId, "brief.md")],
      outputSummary: briefText
    })
  );

  return {
    songId,
    title,
    briefPath: state.briefPath ?? join(input.workspaceRoot, "songs", songId, "brief.md"),
    status: "brief",
    artistReason,
    ledgerEntryIds: [ideationEntry.id, briefEntry.id]
  };
}
