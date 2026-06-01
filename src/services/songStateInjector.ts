import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommissionBrief } from "../types.js";
import { ensureBackupChangeSet, type BackupChangeSet } from "./personaBackup.js";
import { readAutopilotRunState, writeAutopilotRunState } from "./autopilotService.js";
import { ensureSongState, updateSongState, writeSongBrief } from "./artistState.js";
import { secretLikePattern } from "./personaMigrator.js";

export interface SongCommissionInjectionResult {
  songId: string;
  stateBootstrapped: boolean;
  backups: BackupChangeSet;
}

function renderBrief(brief: CommissionBrief): string {
  const sources = brief.sources?.length
    ? [
      "",
      "## Frozen sources",
      "",
      ...brief.sources.map((source) => `- ${source.kind}: ${source.url}${source.author ? ` (${source.author})` : ""}${source.quote ? ` — ${source.quote}` : ""}`)
    ]
    : [];
  return [
    `# Brief for ${brief.title}`,
    "",
    "## Producer commission",
    "",
    brief.brief,
    "",
    "## Direction",
    "",
    `- Lyrics theme: ${brief.lyricsTheme}`,
    `- Mood: ${brief.mood}`,
    `- Tempo: ${brief.tempo}`,
    `- Duration: ${brief.duration}`,
    `- Style notes: ${brief.styleNotes}`,
    ...sources
  ].join("\n");
}

function renderLyricsSeed(brief: CommissionBrief): string {
  return [
    `# Lyrics seed for ${brief.title}`,
    "",
    `Theme: ${brief.lyricsTheme}`,
    `Mood: ${brief.mood}`,
    "",
    "The artist should draft full lyrics during the next autopilot cycle."
  ].join("\n");
}

function guardSecret(value: CommissionBrief): void {
  if (secretLikePattern.test(JSON.stringify(value))) {
    throw new Error("commission_injection_secret_like_text");
  }
}

export async function injectCommissionSong(
  root: string,
  commissionBrief: CommissionBrief,
  options: { now?: Date } = {}
): Promise<SongCommissionInjectionResult> {
  guardSecret(commissionBrief);
  const songId = commissionBrief.songId;
  const songDir = join(root, "songs", songId);
  const briefPath = join(songDir, "brief.md");
  const songPath = join(songDir, "song.md");
  const lyricsPath = join(songDir, "lyrics", "lyrics.v1.md");
  const songbookPath = join(root, "artist", "SONGBOOK.md");
  const autopilotPath = join(root, "runtime", "autopilot-state.json");
  const backups = await ensureBackupChangeSet([songPath, briefPath, lyricsPath, songbookPath, autopilotPath], `commission-${songId}`);

  await ensureSongState(root, songId, commissionBrief.title);
  await writeSongBrief(root, songId, renderBrief(commissionBrief));
  await mkdir(dirname(lyricsPath), { recursive: true });
  await writeFile(lyricsPath, `${renderLyricsSeed(commissionBrief).trim()}\n`, "utf8");
  await updateSongState(root, songId, {
    title: commissionBrief.title,
    status: "brief",
    reason: `producer commission accepted: ${commissionBrief.brief.slice(0, 120)}`
  });

  const state = await readAutopilotRunState(root);
  await writeAutopilotRunState(root, {
    ...state,
    currentSongId: songId,
    stage: "planning",
    paused: false,
    suspendedAt: null,
    blockedReason: undefined,
    lastError: undefined,
    lastRunAt: (options.now ?? new Date()).toISOString()
  });

  return { songId, stateBootstrapped: true, backups };
}
