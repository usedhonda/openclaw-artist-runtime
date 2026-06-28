import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, ArtistRuntimeConfig } from "../types.js";
import { isAiNotConfiguredResponse, isAiProviderMockFallbackResponse, callAiProvider } from "./aiProviderClient.js";
import { readArtistMind, updateSongState } from "./artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";
import { repairLyricsV55 } from "./lyricsRepair.js";
import { validateLyricsV55 } from "./lyricsValidator.js";
import { secretLikePattern } from "./personaMigrator.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { buildLyricsDraftingPrompt, readLyricsKnowledgeDigest } from "./lyricsDraftingPrompt.js";
import { parseLyricsLanguagePolicy } from "./lyricsLanguagePolicy.js";
import { getArtistIdentity, getSunoLyricsLimit } from "./runtimeConfig.js";

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

interface ParsedAiLyricsSection {
  tag?: string;
  label?: string;
  lines?: string[];
  text?: string;
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

function parseField(raw: string, field: string): string {
  const match = raw.match(new RegExp(`(?:^|\\n)${field}:\\s*([\\s\\S]*?)(?=\\n(?:title|lyrics|moodHint):\\s*|$)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function mockStructuredDraft(title: string, briefText: string): string {
  const rawSource = briefText.match(/## Observation source[\s\S]*?Extract:\n([\s\S]*)/i)?.[1]?.split(/\r?\n/).find((line) => line.trim())?.trim()
    ?? briefText.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#"))?.trim()
    ?? "街のノイズがまだ消えない。";
  const source = rawSource.replace(/^-\s*text:\s*"?(.+?)"?\s*$/i, "$1");
  return [
    "{",
    `  "title": "${title.split(/\s+/).slice(0, 4).join(" ") || "Night Ledger"}",`,
    "  \"form\": \"nine-section compact pop\",",
    "  \"sections\": [",
    `    { "tag": "Intro - muted street image", "lines": ["${source.slice(0, 60).replace(/"/g, "'")}"] },`,
    "    { \"tag\": \"Verse 1 - tight civic flow\", \"lines\": [\"誰も見ない窓にだけ信号が残る\", \"既読の街で責任だけが遅れる\", \"低いベースが名前を削っていく\", \"朝の手前でまだ息を数える\"] },",
    "    { \"tag\": \"Hook - repeated anchor\", \"lines\": [\"逃げた声を追わない\", \"画面の外で鳴る\", \"逃げた声を追わない\"] },",
    "    { \"tag\": \"Verse 2 - detail turn\", \"lines\": [\"便利な橋ほど足跡を消した\", \"神棚みたいな稟議が白く光る\", \"笑った顔だけログに残って\", \"誰の夜かを誰も言わない\"] },",
    "    { \"tag\": \"Bridge - thin contrast\", \"lines\": [\"それでも爪の先だけ熱い\", \"黙ったまま角を曲がる\"] },",
    "    { \"tag\": \"Verse 3 - consequence\", \"lines\": [\"錆びた時計が二拍だけずれる\", \"古い店名が雨でほどける\", \"遠い通知に街灯が瞬く\", \"まだ消えないものを拾う\"] },",
    "    { \"tag\": \"Hook - final anchor\", \"lines\": [\"逃げた声を追わない\", \"画面の外で鳴る\", \"逃げた声を追わない\"] },",
    "    { \"tag\": \"Outro - hard stop\", \"lines\": [\"夜明けだけが未送信のまま\"] }",
    "  ],",
    "  \"bilingual_hint\": \"keep Japanese main text\",",
    "  \"moodHint\": \"observed urban unease\"",
    "}"
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonDraft(raw: string, fallbackTitle: string): LyricsDraft | undefined {
  const parsed = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  })();
  if (!isRecord(parsed)) {
    return undefined;
  }
  const sections = Array.isArray(parsed.sections) ? parsed.sections as ParsedAiLyricsSection[] : [];
  const lyrics = sections
    .map((section) => {
      const tag = typeof section.tag === "string" ? section.tag : typeof section.label === "string" ? section.label : "Verse - repaired section";
      const lines = Array.isArray(section.lines)
        ? section.lines.filter((line): line is string => typeof line === "string")
        : typeof section.text === "string" ? section.text.split(/\r?\n/) : [];
      return [`[${tag}]`, ...lines].join("\n");
    })
    .join("\n\n")
    .trim();
  const moodHint = typeof parsed.moodHint === "string" ? parsed.moodHint : "";
  const title = typeof parsed.title === "string" ? parsed.title : fallbackTitle;
  return lyrics && moodHint
    ? { title: title.split(/\s+/).slice(0, 4).join(" "), lyrics, moodHint: moodHint.split(/\s+/).slice(0, 4).join(" ") }
    : undefined;
}

function parseDraft(raw: string, fallbackTitle: string): LyricsDraft | undefined {
  const jsonDraft = parseJsonDraft(raw, fallbackTitle);
  if (jsonDraft) {
    return jsonDraft;
  }
  const title = parseField(raw, "title") || fallbackTitle;
  const lyrics = parseField(raw, "lyrics");
  const moodHint = parseField(raw, "moodHint");
  if (!lyrics || !moodHint) {
    return undefined;
  }
  return { title: title.split(/\s+/).slice(0, 4).join(" "), lyrics, moodHint: moodHint.split(/\s+/).slice(0, 4).join(" ") };
}

function lyricBodyLimitForSunoBox(boxLimit: number): number {
  return Math.max(200, Math.min(2600, boxLimit - 900));
}

async function composeLyricsDraft(input: DraftLyricsInput, title: string, briefText: string): Promise<LyricsDraft> {
  const provider = input.aiReviewProvider ?? input.config?.aiReview?.provider ?? "mock";
  const mind = await readArtistMind(input.workspaceRoot);
  const knowledgeDigest = await readLyricsKnowledgeDigest();
  const identity = await getArtistIdentity(input.workspaceRoot);
  const languagePolicy = parseLyricsLanguagePolicy(mind.artist);
  const lyricsBoxLimit = getSunoLyricsLimit();
  const lyricBodyLimit = lyricBodyLimitForSunoBox(lyricsBoxLimit);
  let repairNotes: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: mind.artist,
      currentState: mind.currentState,
      briefText,
      title,
      knowledgeDigest,
      repairNotes,
      lyricsBoxLimit,
      lyricBodyLimit,
      artistName: identity.artistName,
      languagePolicy
    });
    assertSafe("input", prompt);
    const raw = provider === "mock" ? mockStructuredDraft(title, briefText) : await callAiProvider(prompt, { provider });
    assertSafe("response", raw);
    if (isAiProviderMockFallbackResponse(raw)) {
      repairNotes = isAiNotConfiguredResponse(raw)
        ? ["ai_provider_not_configured: 歌詞AIのトークン失効/未設定 — 再認証が必要"]
        : ["provider fallback response"];
      continue;
    }
    const parsed = parseDraft(raw, title);
    if (!parsed) {
      repairNotes = ["missing structured title, sections, or moodHint"];
      continue;
    }
    const repaired = repairLyricsV55(parsed.lyrics);
    if (repaired.length > lyricBodyLimit) {
      repairNotes = [
        `lyrics_too_long_for_suno_box: lyric body ${repaired.length}/${lyricBodyLimit}, lyrics box ${lyricsBoxLimit}`
      ];
      continue;
    }
    const validation = validateLyricsV55(repaired, { denylist: ["Drake", "Taylor Swift", "Beatles"] });
    if (validation.valid) {
      const finalDraft = { ...parsed, lyrics: repaired };
      assertSafe("final", `${finalDraft.title}\n${finalDraft.lyrics}\n${finalDraft.moodHint}`);
      return finalDraft;
    }
    repairNotes = validation.issues.map((issue) => `${issue.code}: ${issue.message}`).slice(0, 5);
  }
  const notes = repairNotes.length > 0 ? repairNotes : ["unknown lyrics degradation"];
  const error = new Error(`lyrics_generation_degraded: ${notes.join(" | ")}`);
  throw Object.assign(error, { repairNotes: notes });
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
    const repairNotes = Array.isArray((error as { repairNotes?: unknown }).repairNotes)
      ? (error as { repairNotes: string[] }).repairNotes
      : [];
    const detail = repairNotes.join(" | ") || undefined;
    emitRuntimeEvent({ type: "lyrics_generation_degraded", songId: input.songId, reason, detail, repairNotes, timestamp: Date.now() });
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
