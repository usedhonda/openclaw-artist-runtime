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
import { decideDopagakiVariation } from "./creativeVariationPolicy.js";
import { getDurationPlan, minimumBareLyricsChars, minimumBareLyricsLines } from "../suno-production/durationPlan.js";
import { appendCreativeQualityEntry, computeDissBankHits } from "./creativeQualityLedger.js";

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
  const safeTitle = /[\u3400-\u9FFF\u3005]/.test(title) ? "this song" : title;
  return [
    `${safeTitle} waits under the dead neon.`,
    motif,
    "Only the station clock keeps counting the dust.",
    "I leave before the echo learns my name."
  ].join("\n");
}

function sunoSafeMockLine(value: string): string {
  const trimmed = value.trim();
  if (
    /[\u3400-\u9FFF\u3005]/.test(trimmed)
    || /\d/.test(trimmed)
    || /^#/.test(trimmed)
    || /^(?:query|reactionfor|reactionsource|motifs|path|author|url|quote|motivation)\s*:/i.test(trimmed)
  ) {
    return "まちのノイズがまだきえない。";
  }
  return trimmed;
}

function parseField(raw: string, field: string): string {
  const match = raw.match(new RegExp(`(?:^|\\n)${field}:\\s*([\\s\\S]*?)(?=\\n(?:title|lyrics|moodHint):\\s*|$)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function mockStructuredDraft(title: string, briefText: string): string {
  const rawSource = briefText.match(/## Observation source[\s\S]*?Extract:\n([\s\S]*)/i)?.[1]?.split(/\r?\n/).find((line) => line.trim())?.trim()
    ?? briefText.split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#"))?.trim()
    ?? "まちのノイズがまだきえない。";
  const source = rawSource.replace(/^-\s*text:\s*"?(.+?)"?\s*$/i, "$1");
  const safeTitle = JSON.stringify(title.split(/\s+/).slice(0, 4).join(" ") || "Night Ledger");
  const safeSource = JSON.stringify(sunoSafeMockLine(source).slice(0, 60));
  const verseOneLines = Array.from({ length: 16 }, (_, index) => `しぶやのガラスがまたあんぜんのふりをして${index % 2 === 0 ? "だれかのせきにんだけうすくぬるからのポケットにさびたひかりをつめる" : "べんりなかおでよるをすりへらすからのからだにノイズをのこす"}まだほこりがむねでなる`);
  const verseTwoLines = Array.from({ length: 16 }, (_, index) => `ひくいベースがからっぽなりんぎをゆらして${index % 2 === 0 ? "きれいなことばほどくつあとをけすからのまどにほこりをためる" : "まちのねつだけのどにのこるからのサインをかみくだく"}まだがいとうがおくれてまたたく`);
  const prehookOneLines = [
    "safe safe ってだれのため",
    "white white なかべがわらう",
    "ひびだけがさきにうたう",
    "まだかえさない"
  ];
  const prehookTwoLines = [
    "fast fast でまわるあかり",
    "late late なこえがのこる",
    "からのサインがむねをける",
    "まだとまらない"
  ];
  const hookLines = [
    "にげたこえをおわない",
    "がめんのそとでなる",
    "にげたこえをおわない",
    "safe safe だけじゃたりない"
  ];
  const bridgeLines = [
    "それでもつめのさきだけあつい",
    "だまったままかどをまがる",
    "きれいなビルほどかげをふやす",
    "こわれたまちでもまだうたう",
    "はくしゅのあとでほこりがたつ"
  ];
  return [
    "{",
    `  "title": ${safeTitle},`,
    "  \"form\": \"nine-section compact pop\",",
    "  \"sections\": [",
    `    { "tag": "Intro - muted street image", "lines": [${safeSource}] },`,
    `    { "tag": "Verse 1 - tight civic flow", "lines": ${JSON.stringify(verseOneLines)} },`,
    `    { "tag": "Pre-Hook - pressure turn", "lines": ${JSON.stringify(prehookOneLines)} },`,
    `    { "tag": "Hook - repeated anchor", "lines": ${JSON.stringify(hookLines)} },`,
    `    { "tag": "Verse 2 - detail turn", "lines": ${JSON.stringify(verseTwoLines)} },`,
    `    { "tag": "Pre-Hook 2 - pressure answer", "lines": ${JSON.stringify(prehookTwoLines)} },`,
    `    { "tag": "Hook 2 - repeated anchor", "lines": ${JSON.stringify(hookLines)} },`,
    `    { "tag": "Bridge - thin contrast", "lines": ${JSON.stringify(bridgeLines)} },`,
    `    { "tag": "Final Hook - final anchor", "lines": ${JSON.stringify([...hookLines, "はくしゅよりさきにほこりがたつ"])} },`,
    "    { \"tag\": \"Outro - hard stop\", \"lines\": [\"よあけだけがみそうしんのまま\"] }",
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
  return Math.max(200, Math.min(3400, boxLimit - 900));
}

function bareLyricsCharsForDraft(lyrics: string): number {
  return lyrics
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[[^\]]+\]\s*$/.test(line.trim()))
    .join("\n")
    .trim()
    .length;
}

function bareLyricsLinesForDraft(lyrics: string): number {
  return lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^\[[^\]]+\]$/.test(line))
    .length;
}

async function composeLyricsDraft(input: DraftLyricsInput, title: string, briefText: string): Promise<LyricsDraft> {
  const provider = input.aiReviewProvider ?? input.config?.aiReview?.provider ?? "mock";
  const mind = await readArtistMind(input.workspaceRoot);
  const knowledgeDigest = await readLyricsKnowledgeDigest();
  const identity = await getArtistIdentity(input.workspaceRoot);
  const languagePolicy = parseLyricsLanguagePolicy(mind.artist);
  const lyricsBoxLimit = getSunoLyricsLimit();
  const lyricBodyLimit = lyricBodyLimitForSunoBox(lyricsBoxLimit);
  const durationPlan = getDurationPlan();
  const minimumBareChars = minimumBareLyricsChars();
  const minimumBareLines = minimumBareLyricsLines();
  const dopagakiVariation = decideDopagakiVariation({
    songId: input.songId,
    briefText
  });
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
      languagePolicy,
      dopagakiVariation
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
    const bareLyricsChars = bareLyricsCharsForDraft(repaired);
    const bareLyricsLines = bareLyricsLinesForDraft(repaired);
    if (bareLyricsChars < minimumBareChars || bareLyricsLines < minimumBareLines) {
      repairNotes = [
        `lyrics_too_short_for_duration_plan: bare lyric body ${bareLyricsChars}/${minimumBareChars}, lines ${bareLyricsLines}/${minimumBareLines}, planned bars ${durationPlan.totalPlannedBars}`
      ];
      continue;
    }
    const validation = validateLyricsV55(repaired, { denylist: ["Drake", "Taylor Swift", "Beatles"] });
    if (validation.valid) {
      const finalDraft = { ...parsed, lyrics: repaired };
      assertSafe("final", `${finalDraft.title}\n${finalDraft.lyrics}\n${finalDraft.moodHint}`);
      const dissBankHits = computeDissBankHits(mind.artist, repaired);
      // Telemetry only: a ledger write must never fail lyric generation.
      await appendCreativeQualityEntry(input.workspaceRoot, {
        songId: input.songId,
        title: finalDraft.title,
        createdAt: new Date().toISOString(),
        dopagakiActive: dopagakiVariation.active,
        dopagakiThreshold: dopagakiVariation.threshold,
        bareLyricsChars,
        bareLines: bareLyricsLines,
        moodHint: finalDraft.moodHint,
        dissBankHits,
        dissBankHitCount: dissBankHits.length,
        degraded: false
      }).catch(() => undefined);
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
