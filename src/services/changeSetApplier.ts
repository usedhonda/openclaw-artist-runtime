import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SongStatus } from "../types.js";
import { updateSongState, writeSongBrief } from "./artistState.js";
import type { ChangeSetField, ChangeSetProposal } from "./freeformChangesetProposer.js";
import { ensureBackupChangeSet, type BackupChangeSet } from "./personaBackup.js";
import { updateArtistPersonaField, type ArtistPersonaSummary } from "./personaFileBuilder.js";
import { patchResolvedConfig, readResolvedConfig } from "./runtimeConfig.js";
import { updateSoulPersonaField, type SoulPersonaSummary } from "./soulFileBuilder.js";

export interface ChangeSetApplyResult {
  applied: ChangeSetField[];
  skipped: ChangeSetField[];
  warnings: string[];
  backups: BackupChangeSet;
}

function targetPath(root: string, targetFile: string): string {
  return join(root, targetFile);
}

function normalizeSongStatus(value: string): SongStatus | undefined {
  switch (value.trim()) {
    case "idea":
    case "brief":
    case "lyrics":
    case "suno_prompt_pack":
    case "suno_running":
    case "suno_take_url_ready":
    case "takes_imported":
    case "take_selected":
    case "social_assets":
    case "scheduled":
    case "published":
    case "archived":
    case "failed":
      return value.trim() as SongStatus;
    default:
      return undefined;
  }
}

function artistField(field: string): keyof ArtistPersonaSummary | undefined {
  switch (field) {
    case "identityLine":
    case "soundDna":
    case "obsessions":
    case "lyricsRules":
    case "socialVoice":
      return field;
    default:
      return undefined;
  }
}

function soulField(field: string): keyof SoulPersonaSummary | undefined {
  switch (field) {
    case "soul-tone":
    case "conversationTone":
      return "conversationTone";
    case "soul-refusal":
    case "refusalStyle":
      return "refusalStyle";
    default:
      return undefined;
  }
}

async function appendSection(path: string, heading: string, value: string): Promise<void> {
  const current = await readFile(path, "utf8").catch(() => "");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${current.trimEnd()}\n\n## ${heading}\n\n${value.trim()}\n`, "utf8");
}

async function applyField(root: string, proposal: ChangeSetProposal, field: ChangeSetField): Promise<void> {
  if (field.status === "skipped") {
    throw new Error("changeset_field_skipped");
  }
  if (proposal.domain === "persona") {
    if (field.field === "artistName") {
      const current = await readResolvedConfig(root);
      await patchResolvedConfig(root, {
        artist: {
          ...current.artist,
          identity: { ...current.artist.identity, displayName: field.proposedValue.trim() }
        }
      });
      return;
    }
    const artistKey = artistField(field.field);
    if (artistKey) {
      await updateArtistPersonaField(root, artistKey, field.proposedValue);
      return;
    }
    const soulKey = soulField(field.field);
    if (soulKey) {
      await updateSoulPersonaField(root, soulKey, field.proposedValue);
      return;
    }
    throw new Error(`unsupported_persona_field:${field.field}`);
  }

  const songId = proposal.songId;
  if (!songId) {
    throw new Error("missing_song_id");
  }
  if (field.field === "status") {
    const status = normalizeSongStatus(field.proposedValue);
    if (!status) {
      throw new Error(`unsupported_song_status:${field.proposedValue}`);
    }
    await updateSongState(root, songId, { status, reason: "conversation changeset" });
    return;
  }
  if (field.field === "brief") {
    await writeSongBrief(root, songId, field.proposedValue);
    return;
  }
  if (field.field === "lyrics") {
    const lyricsPath = join(root, "songs", songId, "lyrics", "lyrics.v1.md");
    await mkdir(dirname(lyricsPath), { recursive: true });
    await writeFile(lyricsPath, `${field.proposedValue.trim()}\n`, "utf8");
    await updateSongState(root, songId, { status: "lyrics", lyricsVersion: 1, reason: "conversation changeset" });
    return;
  }
  if (field.field.startsWith("publicLinks")) {
    await updateSongState(root, songId, { appendPublicLinks: [field.proposedValue], reason: "conversation changeset" });
    return;
  }
  await appendSection(join(root, "songs", songId, "song.md"), `Conversation ${field.field}`, field.proposedValue);
  await updateSongState(root, songId, { reason: "conversation changeset" });
}

export async function applyChangeSet(root: string, proposal: ChangeSetProposal): Promise<ChangeSetApplyResult> {
  const paths = proposal.fields.map((field) => targetPath(root, field.targetFile));
  const backups = await ensureBackupChangeSet(paths, proposal.id);
  const applied: ChangeSetField[] = [];
  const skipped: ChangeSetField[] = [];
  const warnings: string[] = [];

  for (const field of proposal.fields) {
    try {
      await applyField(root, proposal, field);
      applied.push(field);
    } catch (error) {
      skipped.push(field);
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (warnings.length > 0) {
    const logPath = join(root, "runtime", "changeset-warnings.jsonl");
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify({ proposalId: proposal.id, warnings, at: new Date().toISOString() })}\n`, "utf8");
  }

  return { applied, skipped, warnings, backups };
}
