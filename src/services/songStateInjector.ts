import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommissionBrief, CreativeDecision } from "../types.js";
import { ensureBackupChangeSet, type BackupChangeSet } from "./personaBackup.js";
import { readAutopilotRunState, writeAutopilotRunState } from "./autopilotService.js";
import { ensureSongState, updateSongState, writeSongBrief } from "./artistState.js";
import { secretLikePattern } from "./personaMigrator.js";
import { decideCreative, jstDate } from "./creativeDirector.js";
import { readRecentCreativeDecisions } from "./creativeQualityLedger.js";
import { writeSongPlan } from "./songPlan.js";
import { renderBrief, type BriefModel } from "./briefRenderer.js";
import { bandForBpm } from "../suno-production/durationPlan.js";

export interface SongCommissionInjectionResult {
  songId: string;
  stateBootstrapped: boolean;
  backups: BackupChangeSet;
}

// Parse an explicit bpm out of the commission tempo string, matching
// parseBpmFromBriefTempo's semantics (no bpm for "artist decides"; 40-220 range).
// Used only to derive an agreeing `- Tempo band:` line from the same string, so a
// single tempo source drives both lines.
function parseCommissionBpm(tempo: string): number | undefined {
  if (/artist\s+decides/i.test(tempo)) return undefined;
  const match = tempo.match(/\b(\d{2,3})\b/);
  if (!match) return undefined;
  const bpm = Number(match[1]);
  return Number.isInteger(bpm) && bpm >= 40 && bpm <= 220 ? bpm : undefined;
}

// Build the shared BriefModel for a producer commission. The `- Tempo band:` and
// `- Emotional mode:` lines are new (the old commission renderer omitted them);
// the band is derived from the same tempo string when it carries a bpm, otherwise
// from the persisted decision, so the band and the bpm in one brief always agree.
function commissionBriefModel(brief: CommissionBrief, decision: CreativeDecision): BriefModel {
  const bpm = parseCommissionBpm(brief.tempo);
  const tempoBand = (bpm !== undefined ? bandForBpm(bpm) : undefined) ?? decision.tempo.band;
  return {
    title: brief.title,
    commission: brief.brief,
    lyricsTheme: brief.lyricsTheme,
    mood: brief.mood,
    emotionalModeLabel: decision.emotionalMode.label,
    tempoBand,
    tempoLine: brief.tempo,
    duration: brief.duration,
    styleNotes: brief.styleNotes,
    frozenSources: brief.sources?.map((source) => ({
      kind: source.kind,
      url: source.url,
      author: source.author,
      quote: source.quote
    }))
  };
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

// Persist the creative decision as song-plan.json. The brief normally carries the
// decision the director already made in proposeSpawn; when it does not (a brief
// reconstructed on the approval round-trip, or a legacy commission) the decision
// is recomputed deterministically from the brief's own fields so every song still
// gets a plan for downstream stages to read.
async function persistSongPlan(root: string, songId: string, brief: CommissionBrief): Promise<CreativeDecision> {
  let decision = brief.creativeDecision;
  if (!decision || decision.songId !== songId) {
    const parsedCreatedAt = brief.createdAt ? new Date(brief.createdAt) : new Date();
    const createdAt = Number.isFinite(parsedCreatedAt.getTime()) ? parsedCreatedAt : new Date();
    const personaText = await readFile(join(root, "ARTIST.md"), "utf8").catch(() => "");
    const recentDecisions = await readRecentCreativeDecisions(root, 6);
    const source = brief.sources?.[0];
    decision = decideCreative({
      songId,
      jstDate: jstDate(createdAt),
      personaText,
      observation: source
        ? { url: source.url, author: source.author ?? "", motifScore: source.impactScore ?? 0 }
        : null,
      recentDecisions
    });
  }
  return writeSongPlan(root, decision);
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
  const decision = await persistSongPlan(root, songId, commissionBrief);
  await writeSongBrief(root, songId, renderBrief(commissionBriefModel(commissionBrief, decision)));
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
