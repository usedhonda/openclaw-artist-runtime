import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, ArtistRuntimeConfig } from "../types.js";
import { isAiProviderMockFallbackResponse, callAiProvider } from "./aiProviderClient.js";
import { readArtistMind, updateSongState } from "./artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";
import { secretLikePattern } from "./personaMigrator.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

export interface DraftLyricsInput {
  workspaceRoot: string;
  songId: string;
  config?: Partial<ArtistRuntimeConfig>;
  aiReviewProvider?: AiReviewProvider;
}

interface LyricsDraft {
  title: string;
  lyrics: string;
  moodHint: string;
}

async function nextLyricsVersion(root: string, songId: string): Promise<number> {
  const entries = await readdir(join(root, "songs", songId, "lyrics"), { withFileTypes: true }).catch(() => []);
  const versions = entries
    .filter((entry) => entry.isFile() && /^lyrics\.v\d+\.md$/.test(entry.name))
    .map((entry) => Number.parseInt(entry.name.replace("lyrics.v", "").replace(".md", ""), 10))
    .filter((value) => Number.isFinite(value));
  return (versions.length > 0 ? Math.max(...versions) : 0) + 1;
}

function assertSafe(stage: string, value: string): void {
  if (secretLikePattern.test(value)) {
    throw new Error(`lyrics_generation_secret_like_${stage}`);
  }
}

function deriveLyrics(title: string, brief: string): string {
  const briefLines = brief
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("- "));
  const motif = briefLines[0] ?? "A cold light stays on after midnight.";
  return [
    `${title} waits under the dead neon.`,
    motif,
    "Only the station clock keeps counting the dust.",
    "I leave before the echo learns my name."
  ].join("\n");
}

function truncate(value: string, max = 2400): string {
  return value.length <= max ? value : value.slice(0, max);
}

function parseField(raw: string, field: string): string {
  const match = raw.match(new RegExp(`(?:^|\\n)${field}:\\s*([\\s\\S]*?)(?=\\n(?:title|lyrics|moodHint):\\s*|$)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function buildPrompt(input: { artistMd: string; currentState: string; briefText: string; title: string }): string {
  return [
    "Write lyrics for used::honda from the provided raw material.",
    "Extract one motif from the observation-bearing brief, metabolize it through the artist persona, and avoid generic placeholder lyrics.",
    "Return exactly these fields:",
    "title: 2-4 word short title",
    "lyrics: 4-8 lines of markdown lyrics",
    "moodHint: 2-4 word sonic mood",
    "",
    "ARTIST.md:",
    truncate(input.artistMd),
    "",
    "artist/CURRENT_STATE.md:",
    truncate(input.currentState),
    "",
    `title hint: ${input.title}`,
    "",
    "brief.md:",
    truncate(input.briefText)
  ].join("\n");
}

function mockStructuredDraft(title: string, briefText: string): string {
  const source = briefText.match(/## Observation source[\s\S]*?Extract:\n([\s\S]*)/i)?.[1]?.split(/\r?\n/).find((line) => line.trim())?.trim()
    ?? briefText.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#"))?.trim()
    ?? "街のノイズがまだ消えない。";
  return [
    `title: ${title.split(/\s+/).slice(0, 4).join(" ") || "Night Ledger"}`,
    "lyrics:",
    `${source.slice(0, 80)}`,
    "誰も見ない窓にだけ信号が残る",
    "便利な声ほど責任を遠くへ置く",
    "朝になる前に低いベースで数え直す",
    "moodHint: observed urban unease"
  ].join("\n");
}

function parseDraft(raw: string, fallbackTitle: string): LyricsDraft | undefined {
  const title = parseField(raw, "title") || fallbackTitle;
  const lyrics = parseField(raw, "lyrics");
  const moodHint = parseField(raw, "moodHint");
  if (!lyrics || !moodHint) {
    return undefined;
  }
  return { title: title.split(/\s+/).slice(0, 4).join(" "), lyrics, moodHint: moodHint.split(/\s+/).slice(0, 4).join(" ") };
}

async function composeLyricsDraft(input: DraftLyricsInput, title: string, briefText: string): Promise<LyricsDraft> {
  const provider = input.aiReviewProvider ?? input.config?.aiReview?.provider ?? "mock";
  const mind = await readArtistMind(input.workspaceRoot);
  const prompt = buildPrompt({ artistMd: mind.artist, currentState: mind.currentState, briefText, title });
  assertSafe("input", prompt);
  const raw = provider === "mock" ? mockStructuredDraft(title, briefText) : await callAiProvider(prompt, { provider });
  assertSafe("response", raw);
  if (isAiProviderMockFallbackResponse(raw)) {
    throw new Error("lyrics_generation_degraded");
  }
  const parsed = parseDraft(raw, title);
  if (!parsed) {
    throw new Error("lyrics_generation_degraded");
  }
  assertSafe("final", `${parsed.title}\n${parsed.lyrics}\n${parsed.moodHint}`);
  return parsed;
}

export async function draftLyrics(input: DraftLyricsInput): Promise<{ lyricsText: string; lyricsPath: string; version: number }> {
  const briefPath = join(input.workspaceRoot, "songs", input.songId, "brief.md");
  const songPath = join(input.workspaceRoot, "songs", input.songId, "song.md");
  const [briefText, songText] = await Promise.all([
    readFile(briefPath, "utf8").catch(() => ""),
    readFile(songPath, "utf8").catch(() => "")
  ]);
  const title = songText.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? input.songId;
  const version = await nextLyricsVersion(input.workspaceRoot, input.songId);
  let draft: LyricsDraft;
  try {
    draft = await composeLyricsDraft(input, title, briefText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    emitRuntimeEvent({ type: "lyrics_generation_degraded", songId: input.songId, reason, timestamp: Date.now() });
    await updateSongState(input.workspaceRoot, input.songId, {
      degradedLyrics: true,
      reason,
      status: "brief"
    });
    throw error;
  }
  const lyricsText = draft.lyrics || deriveLyrics(title, briefText);
  const lyricsPath = join(input.workspaceRoot, "songs", input.songId, "lyrics", `lyrics.v${version}.md`);
  await mkdir(join(input.workspaceRoot, "songs", input.songId, "lyrics"), { recursive: true });
  await writeFile(lyricsPath, `${lyricsText}\n`, "utf8");
  await writeFile(join(input.workspaceRoot, "songs", input.songId, "mood-hint.txt"), `${draft.moodHint}\n`, "utf8");

  await appendPromptLedger(
    getSongPromptLedgerPath(input.workspaceRoot, input.songId),
    createPromptLedgerEntry({
      stage: "lyrics_generation",
      songId: input.songId,
      actor: "artist",
      inputRefs: [briefPath],
      outputRefs: [lyricsPath],
      promptText: briefText,
      outputSummary: lyricsText
    })
  );
  await updateSongState(input.workspaceRoot, input.songId, {
    status: "lyrics",
    reason: "lyrics drafted from brief",
    lyricsVersion: version,
    title: draft.title,
    degradedLyrics: false
  });

  return { lyricsText, lyricsPath, version };
}
