import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createSongSkeleton } from "../repositories/songRepository.js";
import type { PersistSunoPromptPackInput, PersistedPromptPackResult, PromptLedgerEntry } from "../types.js";
import { ensureArtistWorkspace, readArtistSnapshots } from "./artistWorkspace.js";
import { readSongState, updateSongState } from "./artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";
import { createSunoPromptPack, createSunoPromptPackWithAi } from "../suno-production/generatePromptPack.js";
import { extractObservationSummary } from "./songIdeation.js";

async function nextPromptPackVersion(promptsDir: string): Promise<number> {
  try {
    const entries = await readdir(promptsDir, { withFileTypes: true });
    const versions = entries
      .filter((entry) => entry.isDirectory() && /^prompt-pack-v\d{3}$/.test(entry.name))
      .map((entry) => Number(entry.name.replace("prompt-pack-v", "")));
    return (versions.length > 0 ? Math.max(...versions) : 0) + 1;
  } catch {
    return 1;
  }
}

export async function readLatestPromptPackMetadata(workspaceRoot: string, songId: string): Promise<{ version: number; metadata: Record<string, unknown> } | undefined> {
  const promptsDir = join(workspaceRoot, "songs", songId, "prompts");
  try {
    const entries = await readdir(promptsDir, { withFileTypes: true });
    const versions = entries
      .filter((entry) => entry.isDirectory() && /^prompt-pack-v\d{3}$/.test(entry.name))
      .map((entry) => Number(entry.name.replace("prompt-pack-v", "")))
      .filter((value) => Number.isFinite(value));
    if (versions.length === 0) {
      return undefined;
    }
    const version = Math.max(...versions);
    const metadataPath = join(promptsDir, `prompt-pack-v${String(version).padStart(3, "0")}`, "metadata.json");
    const raw = await import("node:fs/promises").then(({ readFile }) => readFile(metadataPath, "utf8"));
    return {
      version,
      metadata: JSON.parse(raw) as Record<string, unknown>
    };
  } catch {
    return undefined;
  }
}

async function writeText(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendEntries(ledgerPath: string, entries: PromptLedgerEntry[]): Promise<string[]> {
  const ids: string[] = [];
  for (const entry of entries) {
    const appended = await appendPromptLedger(ledgerPath, entry);
    ids.push(appended.id);
  }
  return ids;
}

function observationRefs(root: string, observationPath?: string): string[] {
  if (!observationPath) {
    return [];
  }
  const rel = relative(root, observationPath);
  return [rel && !rel.startsWith("..") ? rel : observationPath];
}

export async function createAndPersistSunoPromptPack(input: PersistSunoPromptPackInput): Promise<PersistedPromptPackResult> {
  await ensureArtistWorkspace(input.workspaceRoot);
  await createSongSkeleton(input.workspaceRoot, input.songId);

  const { artistSnapshot, currentStateSnapshot } = await readArtistSnapshots(input.workspaceRoot);
  const promptPackInput = {
    ...input,
    artistSnapshot: input.artistSnapshot || artistSnapshot,
    currentStateSnapshot: input.currentStateSnapshot || currentStateSnapshot
  };
  const useAi = input.aiReviewProvider && input.aiReviewProvider !== "mock";
  const pack = useAi
    ? await createSunoPromptPackWithAi({ ...promptPackInput, aiReviewProvider: input.aiReviewProvider })
    : createSunoPromptPack(promptPackInput);

  const promptsDir = join(input.workspaceRoot, "songs", input.songId, "prompts");
  const lyricsDir = join(input.workspaceRoot, "songs", input.songId, "lyrics");
  const sunoDir = join(input.workspaceRoot, "songs", input.songId, "suno");
  const version = await nextPromptPackVersion(promptsDir);
  const versionTag = `v${String(version).padStart(3, "0")}`;
  const snapshotDir = join(promptsDir, `prompt-pack-${versionTag}`);
  await mkdir(snapshotDir, { recursive: true });

  const lyricsVersioned = join(lyricsDir, `lyrics.v${version}.md`);
  const lyricsSunoLatest = join(sunoDir, "lyrics-suno.md");
  const yamlLatest = join(sunoDir, "yaml-suno.md");
  const styleLatest = join(sunoDir, "style.md");
  const excludeLatest = join(sunoDir, "exclude.md");
  const slidersLatest = join(sunoDir, "sliders.json");
  const payloadLatest = join(sunoDir, "suno-payload.json");
  const validationLatest = join(sunoDir, "validation.json");
  const ledgerPath = getSongPromptLedgerPath(input.workspaceRoot, input.songId);

  await Promise.all([
    writeText(lyricsVersioned, `${input.lyricsText}\n`),
    writeText(lyricsSunoLatest, `${input.lyricsText}\n`),
    writeText(yamlLatest, `${pack.yamlLyrics}\n`),
    writeText(styleLatest, `${pack.style}\n`),
    writeText(excludeLatest, `${pack.exclude}\n`),
    writeJson(slidersLatest, pack.sliders),
    writeJson(payloadLatest, pack.payload),
    writeJson(validationLatest, pack.validation),
    writeText(join(snapshotDir, "lyrics.md"), `${input.lyricsText}\n`),
    writeText(join(snapshotDir, "lyrics-suno.md"), `${input.lyricsText}\n`),
    writeText(join(snapshotDir, "yaml-suno.md"), `${pack.yamlLyrics}\n`),
    writeText(join(snapshotDir, "style.md"), `${pack.style}\n`),
    writeText(join(snapshotDir, "exclude.md"), `${pack.exclude}\n`),
    writeJson(join(snapshotDir, "sliders.json"), pack.sliders),
    writeJson(join(snapshotDir, "suno-payload.json"), pack.payload),
    writeJson(join(snapshotDir, "validation.json"), pack.validation),
    writeJson(join(snapshotDir, "metadata.json"), {
      songId: input.songId,
      version,
      promptHash: pack.promptHash,
      payloadHash: pack.payloadHash,
      artistSnapshotHash: pack.artistSnapshotHash,
      currentStateHash: pack.currentStateHash,
      knowledgePackHash: pack.knowledgePackHash
    })
  ]);

  const commonRefs = [
    join(snapshotDir, "lyrics.md"),
    join(snapshotDir, "lyrics-suno.md"),
    join(snapshotDir, "yaml-suno.md"),
    join(snapshotDir, "style.md"),
    join(snapshotDir, "exclude.md"),
    join(snapshotDir, "suno-payload.json"),
    ...observationRefs(input.workspaceRoot, input.observationPath)
  ];
  const sourceRefs = observationRefs(input.workspaceRoot, input.observationPath);
  const currentObservationSummary = (await readSongState(input.workspaceRoot, input.songId).catch(() => undefined))?.observationSummary;
  const observationSummary = input.observationSummary ?? currentObservationSummary ?? (
    input.observationPath
      ? extractObservationSummary(await readFile(input.observationPath, "utf8").catch(() => ""), input.artistReason)
      : undefined
  );

  const ledgerEntryIds = await appendEntries(ledgerPath, [
    createPromptLedgerEntry({
      stage: "artist_state_snapshot",
      songId: input.songId,
      actor: "system",
      inputRefs: ["ARTIST.md", "artist/CURRENT_STATE.md", ...sourceRefs],
      outputRefs: [join(snapshotDir, "metadata.json")],
      configSnapshot: input.configSnapshot,
      artistSnapshotHash: pack.artistSnapshotHash,
      currentStateHash: pack.currentStateHash,
      knowledgePackHash: pack.knowledgePackHash
    }),
    createPromptLedgerEntry({
      stage: "lyrics_generation",
      songId: input.songId,
      actor: "artist",
      artistReason: input.artistReason,
      inputRefs: ["ARTIST.md", "artist/CURRENT_STATE.md", ...sourceRefs],
      outputRefs: [lyricsVersioned, lyricsSunoLatest, join(snapshotDir, "lyrics.md"), join(snapshotDir, "lyrics-suno.md")],
      promptText: input.lyricsText,
      promptHash: pack.promptHash,
      configSnapshot: input.configSnapshot,
      artistSnapshotHash: pack.artistSnapshotHash,
      currentStateHash: pack.currentStateHash,
      knowledgePackHash: pack.knowledgePackHash
    }),
    createPromptLedgerEntry({
      stage: "suno_style_generation",
      songId: input.songId,
      actor: "artist",
      artistReason: input.artistReason,
      inputRefs: [lyricsSunoLatest, ...sourceRefs],
      outputRefs: [styleLatest, join(snapshotDir, "style.md")],
      outputSummary: pack.style,
      promptHash: pack.promptHash,
      configSnapshot: input.configSnapshot,
      artistSnapshotHash: pack.artistSnapshotHash,
      currentStateHash: pack.currentStateHash,
      knowledgePackHash: pack.knowledgePackHash
    }),
    createPromptLedgerEntry({
      stage: "suno_exclude_generation",
      songId: input.songId,
      actor: "artist",
      inputRefs: [lyricsSunoLatest, ...sourceRefs],
      outputRefs: [excludeLatest, join(snapshotDir, "exclude.md")],
      outputSummary: pack.exclude,
      promptHash: pack.promptHash,
      configSnapshot: input.configSnapshot,
      artistSnapshotHash: pack.artistSnapshotHash,
      currentStateHash: pack.currentStateHash,
      knowledgePackHash: pack.knowledgePackHash
    }),
    createPromptLedgerEntry({
      stage: "suno_yaml_generation",
      songId: input.songId,
      actor: "artist",
      inputRefs: [lyricsSunoLatest, ...sourceRefs],
      outputRefs: [yamlLatest, join(snapshotDir, "yaml-suno.md")],
      outputSummary: pack.yamlLyrics,
      promptHash: pack.promptHash,
      configSnapshot: input.configSnapshot,
      artistSnapshotHash: pack.artistSnapshotHash,
      currentStateHash: pack.currentStateHash,
      knowledgePackHash: pack.knowledgePackHash
    }),
    createPromptLedgerEntry({
      stage: "suno_payload_build",
      songId: input.songId,
      actor: "system",
      artistReason: input.artistReason,
      inputRefs: commonRefs,
      outputRefs: [slidersLatest, payloadLatest, validationLatest, join(snapshotDir, "metadata.json")],
      promptHash: pack.promptHash,
      outputHash: pack.payloadHash,
      payloadHash: pack.payloadHash,
      configSnapshot: input.configSnapshot,
      artistSnapshotHash: pack.artistSnapshotHash,
      currentStateHash: pack.currentStateHash,
      knowledgePackHash: pack.knowledgePackHash,
      verification: {
        status: pack.validation.valid ? "verified" : "failed",
        detail: pack.validation.errors.join("; ")
      }
    })
  ]);

  await updateSongState(input.workspaceRoot, input.songId, {
    status: "suno_prompt_pack",
    title: input.songTitle,
    reason: "Suno prompt pack persisted",
    lyricsVersion: version,
    observationSummary
  });

  return {
    songId: input.songId,
    packVersion: version,
    pack,
    artifactPaths: {
      lyricsVersioned,
      yamlLatest,
      lyricsSunoLatest,
      styleLatest,
      excludeLatest,
      slidersLatest,
      payloadLatest,
      validationLatest,
      snapshotDir,
      promptLedger: ledgerPath
    },
    ledgerEntryIds
  };
}
