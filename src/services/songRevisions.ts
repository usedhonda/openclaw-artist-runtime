import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { createAndPersistSunoPromptPack } from "./sunoPromptPackFiles.js";
import { readSongState } from "./artistState.js";

export interface LyricRevisionChange {
  section?: string;
  before: string;
  after: string;
}

export interface LyricRevisionCandidate {
  songId: string;
  title: string;
  version: number;
  text: string;
  textHash: string;
  changes: string[];
  source: { kind: "adopted_lyrics" | "candidate"; version: number };
  sourceVersion: number;
  instruction: string;
  createdAt: string;
}

export interface SaveLyricRevisionInput {
  workspaceRoot: string;
  songId: string;
  instruction: string;
  text?: string;
  changes?: LyricRevisionChange[] | Record<string, string>;
  source: { kind: "adopted_lyrics" | "candidate"; version: number };
  expectedSourceHash: string;
}

export interface RestoreLyricRevisionInput {
  workspaceRoot: string;
  songId: string;
  instruction: string;
  version: number;
  changes?: LyricRevisionChange[] | Record<string, string>;
  text?: string;
  kind?: "adopted_lyrics" | "candidate";
  targetVersion?: number;
  targetKind?: "adopted_lyrics" | "candidate";
  expectedText?: string;
}

export interface AdoptLyricRevisionInput {
  workspaceRoot: string;
  songId: string;
  version: number;
  artistReason: string;
  expectedTextHash?: string;
  songTitle?: string;
}

export interface SongMaterialVersion {
  kind: "adopted_lyrics" | "candidate";
  version: number;
  text: string;
  textHash: string;
  title?: string;
  instruction?: string;
}

interface AdoptionReceipt {
  candidateVersion: number;
  candidateHash: string;
  promptPack: Awaited<ReturnType<typeof createAndPersistSunoPromptPack>>;
}

const adoptionLocks = new Map<string, Promise<unknown>>();

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function validateSongId(songId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(songId) || songId === "." || songId === "..") {
    throw new Error(`invalid existing song id: ${songId}`);
  }
}

function rootSong(root: string, songId: string): string {
  validateSongId(songId);
  return join(resolve(root), "songs", songId);
}

async function assertExistingSong(root: string, songId: string): Promise<string> {
  const songRoot = rootSong(root, songId);
  const rootReal = await realpath(resolve(root));
  const songFile = join(songRoot, "song.md");
  await stat(songFile).catch(() => {
    throw new Error(`existing song not found: ${songId}`);
  });
  const songReal = await realpath(songFile);
  if (relative(rootReal, songReal).startsWith(`..${sep}`) || relative(rootReal, songReal) === "..") {
    throw new Error(`song path escapes workspace: ${songId}`);
  }
  return songRoot;
}

async function adoptedVersions(songRoot: string): Promise<number[]> {
  const entries = await readdir(join(songRoot, "lyrics"), { withFileTypes: true }).catch(() => []);
  return entries.map((entry) => Number(entry.name.match(/^lyrics\.v(\d+)\.md$/)?.[1]))
    .filter((version) => Number.isInteger(version) && version > 0)
    .sort((a, b) => a - b);
}

async function readAdopted(songRoot: string, version?: number): Promise<SongMaterialVersion> {
  const versions = await adoptedVersions(songRoot);
  const selected = version ?? versions.at(-1);
  if (!selected || !versions.includes(selected)) throw new Error(`adopted lyrics version not found: ${version ?? "latest"}`);
  const text = await readFile(join(songRoot, "lyrics", `lyrics.v${selected}.md`), "utf8");
  return { kind: "adopted_lyrics", version: selected, text: text.trim(), textHash: hashText(text.trim()) };
}

function candidateDir(songRoot: string): string { return join(songRoot, "lyrics", "revisions"); }

async function candidateVersions(songRoot: string): Promise<number[]> {
  const entries = await readdir(candidateDir(songRoot), { withFileTypes: true }).catch(() => []);
  return entries.map((entry) => Number(entry.name.match(/^candidate\.v(\d+)\.json$/)?.[1]))
    .filter((version) => Number.isInteger(version) && version > 0)
    .sort((a, b) => a - b);
}

async function readCandidate(songRoot: string, version: number): Promise<LyricRevisionCandidate> {
  const raw = await readFile(join(candidateDir(songRoot), `candidate.v${version}.json`), "utf8").catch(() => undefined);
  if (!raw) throw new Error(`lyric revision candidate not found: ${version}`);
  return JSON.parse(raw) as LyricRevisionCandidate;
}

function applyChanges(source: string, changes: LyricRevisionChange[] | Record<string, string>): { text: string; labels: string[] } {
  const normalized: LyricRevisionChange[] = Array.isArray(changes)
    ? changes
    : Object.entries(changes).map(([section, after]) => ({ section, before: section, after }));
  let text = source;
  const labels: string[] = [];
  for (const change of normalized) {
    if (!change.before) throw new Error("partial lyric change requires exact before text");
    const count = text.split(change.before).length - 1;
    if (count !== 1) throw new Error(`exact lyric change did not match once${change.section ? ` in ${change.section}` : ""}`);
    text = text.replace(change.before, change.after);
    labels.push(change.section ?? "text");
  }
  return { text, labels };
}

export async function listSongMaterialVersions(workspaceRoot: string, songId: string): Promise<SongMaterialVersion[]> {
  const songRoot = await assertExistingSong(workspaceRoot, songId);
  const adopted = await Promise.all((await adoptedVersions(songRoot)).map((version) => readAdopted(songRoot, version)));
  const candidates = await Promise.all((await candidateVersions(songRoot)).map(async (version) => {
    const candidate = await readCandidate(songRoot, version);
    return { kind: "candidate" as const, version, text: candidate.text, textHash: candidate.textHash, title: candidate.title, instruction: candidate.instruction };
  }));
  return [...adopted, ...candidates].sort((a, b) => a.kind.localeCompare(b.kind) || a.version - b.version);
}

export async function readSongMaterialVersion(workspaceRoot: string, songId: string, version: number, kind: "adopted_lyrics" | "candidate" = "candidate"): Promise<SongMaterialVersion> {
  const songRoot = await assertExistingSong(workspaceRoot, songId);
  return kind === "candidate" ? (() => readCandidate(songRoot, version).then((candidate) => ({ kind, version, text: candidate.text, textHash: candidate.textHash, title: candidate.title, instruction: candidate.instruction })))() : readAdopted(songRoot, version);
}

async function readVersion(songRoot: string, kind: "adopted_lyrics" | "candidate", version: number): Promise<SongMaterialVersion> {
  if (!Number.isInteger(version) || version < 1) throw new Error(`invalid material version: ${version}`);
  return kind === "candidate"
    ? readCandidate(songRoot, version).then((candidate) => ({ kind, version, text: candidate.text, textHash: candidate.textHash, title: candidate.title, instruction: candidate.instruction }))
    : readAdopted(songRoot, version);
}

async function readAdoptionReceipt(songRoot: string, candidateVersion: number, candidateHash: string): Promise<AdoptionReceipt | undefined> {
  const raw = await readFile(join(candidateDir(songRoot), "adoptions.jsonl"), "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as AdoptionReceipt)
    .find((receipt) => receipt.candidateVersion === candidateVersion && receipt.candidateHash === candidateHash);
}

export async function saveLyricRevision(input: SaveLyricRevisionInput): Promise<LyricRevisionCandidate> {
  const songRoot = await assertExistingSong(input.workspaceRoot, input.songId);
  if (!input.instruction.trim()) throw new Error("revision instruction is required");
  const source = await readVersion(songRoot, input.source.kind, input.source.version);
  if (source.textHash !== input.expectedSourceHash) throw new Error("source lyrics changed; hash check failed");
  if (input.text === undefined && input.changes === undefined) throw new Error("revision requires text or partial changes");
  const applied = input.text !== undefined ? { text: input.text.trim(), labels: ["full"] } : applyChanges(source.text, input.changes!);
  if (!applied.text) throw new Error("revision lyrics must not be empty");
  await mkdir(candidateDir(songRoot), { recursive: true });
  const candidateReal = await realpath(candidateDir(songRoot));
  const workspaceReal = await realpath(resolve(input.workspaceRoot));
  const candidateRelative = relative(workspaceReal, candidateReal);
  if (candidateRelative.startsWith(`..${sep}`) || candidateRelative === "..") throw new Error("revision path escapes workspace");
  const versions = await candidateVersions(songRoot);
  const version = (versions.at(-1) ?? 0) + 1;
  const candidate: LyricRevisionCandidate = {
    songId: input.songId,
    title: (await readSongState(input.workspaceRoot, input.songId)).title,
    version,
    text: applied.text,
    textHash: hashText(applied.text),
    changes: applied.labels,
    source: { kind: input.source.kind, version: source.version },
    sourceVersion: source.version,
    instruction: input.instruction.trim(),
    createdAt: new Date().toISOString()
  };
  await writeFile(join(candidateDir(songRoot), `candidate.v${version}.json`), `${JSON.stringify(candidate, null, 2)}\n`, { flag: "wx" });
  return candidate;
}

export async function restoreLyricRevision(input: RestoreLyricRevisionInput): Promise<LyricRevisionCandidate> {
  const songRoot = await assertExistingSong(input.workspaceRoot, input.songId);
  const source = await readVersion(songRoot, input.kind ?? "candidate", input.version);
  if (input.expectedText !== undefined && input.expectedText !== source.text) throw new Error("candidate changed; exact-text check failed");
  const target = input.targetVersion === undefined
    ? source
    : await readVersion(songRoot, input.targetKind ?? "candidate", input.targetVersion);
  const restoredText = input.text ?? (input.changes ? applyChanges(target.text, input.changes).text : source.text);
  return saveLyricRevision({ workspaceRoot: input.workspaceRoot, songId: input.songId, instruction: input.instruction, text: restoredText, source: input.targetVersion === undefined ? { kind: source.kind, version: source.version } : { kind: target.kind, version: target.version }, expectedSourceHash: target.textHash });
}

export async function adoptLyricRevision(input: AdoptLyricRevisionInput): Promise<{ candidate: LyricRevisionCandidate; promptPack: Awaited<ReturnType<typeof createAndPersistSunoPromptPack>> }> {
  const songRoot = await assertExistingSong(input.workspaceRoot, input.songId);
  const candidate = await readCandidate(songRoot, input.version);
  if (!input.expectedTextHash || candidate.textHash !== input.expectedTextHash) throw new Error("candidate hash changed; adoption refused");
  const lockKey = `${songRoot}:${candidate.version}:${candidate.textHash}`;
  const previous = adoptionLocks.get(lockKey);
  if (previous) await previous;
  const operation = (async () => {
    const existing = await readAdoptionReceipt(songRoot, candidate.version, candidate.textHash);
    if (existing) return existing.promptPack;
    const song = await readSongState(input.workspaceRoot, input.songId);
    const promptPack = await createAndPersistSunoPromptPack({
      workspaceRoot: input.workspaceRoot,
      songId: input.songId,
      songTitle: input.songTitle ?? song.title,
      artistReason: input.artistReason,
      lyricsText: candidate.text,
      preserveSongStatus: true
    });
    await appendFile(join(candidateDir(songRoot), "adoptions.jsonl"), `${JSON.stringify({ candidateVersion: candidate.version, candidateHash: candidate.textHash, promptPack })}\n`, "utf8");
    return promptPack;
  })();
  adoptionLocks.set(lockKey, operation);
  try {
    return { candidate, promptPack: await operation };
  } finally {
    adoptionLocks.delete(lockKey);
  }
}
