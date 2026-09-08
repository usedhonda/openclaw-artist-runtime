import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PersistedPromptPackResult, SunoPromptPack, SunoSliders, SunoPromptPackValidation } from "../types.js";
import { bandForBpm } from "../suno-production/durationPlan.js";
import { createAndPersistSunoPromptPack, readLatestPromptPackMetadata } from "./sunoPromptPackFiles.js";
import { readSongState } from "./artistState.js";
import { readSongMaterialVersion, withSongMaterialLock } from "./songRevisions.js";

export interface ProductionRevisionPatch {
  title?: string;
  bpm?: number;
  direction?: string;
  excludeStyles?: string[];
}

export interface ProductionLyricRef {
  kind: "adopted_lyrics" | "candidate";
  version: number;
  hash: string;
}

export interface ReviseSongProductionInput {
  workspaceRoot: string;
  songId: string;
  basePackVersion: number;
  expectedBasePayloadHash: string;
  lyric: ProductionLyricRef;
  producerInstruction: string;
  patch?: ProductionRevisionPatch;
}

export interface SongProductionRevision {
  revisionId: string;
  songId: string;
  basePackVersion: number;
  basePayloadHash: string;
  lyric: ProductionLyricRef;
  producerInstruction: string;
  effective: { title: string; bpm?: number; direction: string; excludeStyles: string[] };
  baseline: { status: string; selectedTakeId?: string };
  packVersion: number;
  payloadHash: string;
  origin: "producer_revision";
  createdAt: string;
  promptPack: PersistedPromptPackResult;
}

const revisionDir = (root: string, songId: string) => join(root, "songs", songId, "production-revisions");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function readBase(root: string, songId: string, version: number, payloadHash: string): Promise<{ version: number; metadata: Record<string, unknown>; payload: Record<string, unknown>; pack: SunoPromptPack; inheritedDirection: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(songId) || !Number.isInteger(version) || version < 1) throw new Error("invalid production revision base");
  const latest = await readLatestPromptPackMetadata(root, songId);
  if (!latest || latest.version !== version || latest.metadata.payloadHash !== payloadHash) throw new Error("base prompt pack is stale or hash mismatch");
  const snapshot = join(root, "songs", songId, "prompts", `prompt-pack-v${String(version).padStart(3, "0")}`);
  const payload = JSON.parse(await readFile(join(snapshot, "suno-payload.json"), "utf8")) as Record<string, unknown>;
  if (hash(JSON.stringify(payload)) !== payloadHash) throw new Error("base prompt pack payload hash mismatch");
  const pack: SunoPromptPack = {
    songId,
    songTitle: String(payload.songName ?? songId),
    artistReason: String(payload.artistReason ?? ""),
    lyricsBundle: { originalLyricsText: (await readFile(join(snapshot, "lyrics.md"), "utf8")).replace(/\n$/, ""), lyricsText: (await readFile(join(snapshot, "lyrics-suno.md"), "utf8")).replace(/\n$/, ""), yamlLyrics: (await readFile(join(snapshot, "yaml-suno.md"), "utf8")).trimEnd() },
    style: (await readFile(join(snapshot, "style.md"), "utf8")).trimEnd(),
    exclude: (await readFile(join(snapshot, "exclude.md"), "utf8")).trim(),
    yamlLyrics: (await readFile(join(snapshot, "yaml-suno.md"), "utf8")).trimEnd(),
    sliders: JSON.parse(await readFile(join(snapshot, "sliders.json"), "utf8")) as SunoSliders,
    payload,
    validation: JSON.parse(await readFile(join(snapshot, "validation.json"), "utf8")) as SunoPromptPackValidation,
    promptHash: String(latest.metadata.promptHash ?? ""),
    payloadHash,
    artistSnapshotHash: String(latest.metadata.artistSnapshotHash ?? ""),
    currentStateHash: String(latest.metadata.currentStateHash ?? ""),
    knowledgePackHash: String(latest.metadata.knowledgePackHash ?? "")
  };
  const prior = await listSongProductionRevisions(root, songId);
  return { ...latest, payload, pack, inheritedDirection: prior.find((revision) => revision.packVersion === version)?.effective.direction ?? "" };
}

async function findExisting(dir: string, revisionId: string): Promise<SongProductionRevision | undefined> {
  const raw = await readFile(join(dir, `revision-${revisionId}.json`), "utf8").catch(() => undefined);
  return raw ? JSON.parse(raw) as SongProductionRevision : undefined;
}

export async function reviseSongProduction(input: ReviseSongProductionInput): Promise<SongProductionRevision> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.songId) || !Number.isInteger(input.basePackVersion) || input.basePackVersion < 1 || !Number.isInteger(input.lyric.version) || input.lyric.version < 1) throw new Error("invalid production revision input");
  if (!input.producerInstruction.trim()) throw new Error("producer instruction is required");
  const patch = input.patch ?? {};
  if (patch.bpm !== undefined && (!Number.isInteger(patch.bpm) || patch.bpm < 40 || patch.bpm > 220)) throw new Error("bpm must be an integer between 40 and 220");
  if (Array.isArray(patch.excludeStyles) && patch.excludeStyles.length === 0) throw new Error("empty exclusions are not allowed");
  return withSongMaterialLock(input.workspaceRoot, input.songId, async () => {
    const dir = revisionDir(input.workspaceRoot, input.songId);
    const effectiveKey = JSON.stringify({
      basePackVersion: input.basePackVersion,
      basePayloadHash: input.expectedBasePayloadHash,
      lyric: input.lyric,
      producerInstruction: input.producerInstruction.trim(),
      patch: { title: patch.title?.trim(), bpm: patch.bpm, direction: patch.direction?.trim(), excludeStyles: patch.excludeStyles?.map((item) => item.trim()).filter(Boolean) }
    });
    const revisionId = hash(effectiveKey);
    const existing = await findExisting(dir, revisionId);
    if (existing) return existing;
    const base = await readBase(input.workspaceRoot, input.songId, input.basePackVersion, input.expectedBasePayloadHash);
    const lyric = await readSongMaterialVersion(input.workspaceRoot, input.songId, input.lyric.version, input.lyric.kind);
    if (lyric.textHash !== input.lyric.hash) throw new Error("source lyrics changed; hash check failed");
    const state = await readSongState(input.workspaceRoot, input.songId);
    const title = patch.title?.trim() || String(base.payload.songName ?? state.title);
    const baseTempo = String(base.pack.style).match(/\b(?:(\d{2,3})\s*BPM|BPM\s*(\d{2,3}))\b/i);
    const baseBpm = Number(baseTempo?.[1] ?? baseTempo?.[2]) || undefined;
    const bpm = patch.bpm ?? baseBpm;
    const excludeStyles = patch.excludeStyles?.length ? patch.excludeStyles : base.pack.exclude.split(",").map((item) => item.trim()).filter(Boolean);
    const inheritedDirection = base.inheritedDirection.trim();
    const revisionBasePack = patch.direction?.trim() && inheritedDirection && base.pack.style.endsWith(`, ${inheritedDirection}`)
      ? { ...base.pack, style: base.pack.style.slice(0, -inheritedDirection.length - 2).trimEnd() }
      : base.pack;
    const promptPack = await createAndPersistSunoPromptPack({
      workspaceRoot: input.workspaceRoot,
      songId: input.songId,
      songTitle: title,
      artistReason: String(base.payload.artistReason ?? input.producerInstruction),
      lyricsText: lyric.text,
      bpm,
      tempoBand: bpm === undefined ? undefined : bandForBpm(bpm),
      artistSnapshot: undefined,
      currentStateSnapshot: undefined,
      preserveSongStatus: true,
      preserveExistingLyricsVersions: true,
      productionOverrides: { basePack: revisionBasePack, direction: patch.direction || base.inheritedDirection, inheritedDirection: base.inheritedDirection, excludeStyles }
    });
    const revision: SongProductionRevision = {
      revisionId,
      songId: input.songId,
      basePackVersion: input.basePackVersion,
      basePayloadHash: input.expectedBasePayloadHash,
      lyric: input.lyric,
      producerInstruction: input.producerInstruction.trim(),
      effective: { title, bpm, direction: patch.direction?.trim() || base.inheritedDirection, excludeStyles },
      baseline: { status: state.status, selectedTakeId: state.selectedTakeId },
      packVersion: promptPack.packVersion,
      payloadHash: promptPack.pack.payloadHash,
      origin: "producer_revision",
      createdAt: new Date().toISOString(),
      promptPack
    };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `revision-${revisionId}.json`), `${JSON.stringify(revision, null, 2)}\n`, { flag: "wx" });
    return revision;
  });
}

export async function listSongProductionRevisions(workspaceRoot: string, songId: string): Promise<SongProductionRevision[]> {
  const entries = await readdir(revisionDir(workspaceRoot, songId), { withFileTypes: true }).catch(() => []);
  const revisions = await Promise.all(entries.filter((entry) => /^revision-[a-f0-9]{64}\.json$/.test(entry.name)).map((entry) => readFile(join(revisionDir(workspaceRoot, songId), entry.name), "utf8").then((raw) => JSON.parse(raw) as SongProductionRevision)));
  return revisions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function readSongProductionRevision(workspaceRoot: string, songId: string, revisionId: string): Promise<SongProductionRevision> {
  const revision = await findExisting(revisionDir(workspaceRoot, songId), revisionId);
  if (!revision) throw new Error(`production revision not found: ${revisionId}`);
  return revision;
}
