import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, ArtistRuntimeConfig } from "../types.js";
import { isAiNotConfiguredResponse, isAiProviderMockFallbackResponse, callAiProvider } from "./aiProviderClient.js";
import { readArtistMind, updateSongState } from "./artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";
import { repairLyricsV55 } from "./lyricsRepair.js";
import { parseLyricsSections, validateLyricsV55 } from "./lyricsValidator.js";
import { secretLikePattern } from "./personaMigrator.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { buildLyricsDraftingPrompt, readLyricsKnowledgeDigest } from "./lyricsDraftingPrompt.js";
import { parseLyricsLanguagePolicy } from "./lyricsLanguagePolicy.js";
import { getArtistIdentity, getSunoLyricsLimit } from "./runtimeConfig.js";
import { buildIntroVariantById, decideDopagakiVariation, resolveIntroVariant, type IntroVariant } from "./creativeVariationPolicy.js";
import { readSongPlan } from "./songPlan.js";
import { getDurationPlan, minimumBareLyricsChars, minimumBareLyricsLines, resolveTempoBandFromBrief } from "../suno-production/durationPlan.js";
import { appendCreativeQualityEntry, computeDissBankHits, readCreativeQualityLedger } from "./creativeQualityLedger.js";

export interface DraftLyricsInput {
  workspaceRoot: string;
  songId: string;
  config?: Partial<ArtistRuntimeConfig>;
  aiReviewProvider?: AiReviewProvider;
  // Feedback from a failed prompt-pack validation (offending kanji/numbers) so a
  // corrective re-draft can open or replace them. Seeded as repair notes.
  correctionGuidance?: string[];
  deferDegradedNotification?: boolean;
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

// Exculpatory ("免罪句") phrases that pull the fang out of a diss by disclaiming
// the attack inside the lyric body. The safety line is the writer's discipline,
// not a caption the song sings, so these are lint-detected in a drafted lyric.
const SOFTENER_PATTERN = /個人攻撃ではない|悪者はいない|誰も悪くない|no villain|not (?:an )?attack|nothing personal/i;
const SOFTENER_REPAIR_NOTE =
  "softener_detected: 免罪句（「個人攻撃ではない」「悪者はいない」「誰も悪くない」「no villain here」類）を歌詞から全て削除し、punchline を弱めずに書き直せ。安全線は歌詞に但し書きとして書かない。";

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
  // Dense bands (e.g. dopagaki) raise the DurationPlan line floor above the base
  // mock size. repairLineCount caps each section post-repair (verse max 21,
  // hook / pre-hook max 6 because "Pre-Hook" matches the hook bound, bridge 3,
  // intro/outro 1), so pad only the verses and pre-hooks up to their real caps
  // to clear the selected plan's floor without ballooning the lyric body past
  // the Suno box budget. mid/slow bands already clear their floor from the base
  // draft, so this loop leaves them untouched.
  const draftPlan = getDurationPlan(resolveTempoBandFromBrief(briefText));
  const padTargets = [
    { lines: verseOneLines, cap: 21 },
    { lines: verseTwoLines, cap: 21 },
    { lines: prehookOneLines, cap: 6 },
    { lines: prehookTwoLines, cap: 6 }
  ];
  const fixedLines = 1 + hookLines.length * 2 + Math.min(bridgeLines.length, 3) + (hookLines.length + 1) + 1;
  const countedPadded = () => padTargets.reduce((sum, target) => sum + Math.min(target.lines.length, target.cap), 0);
  // Small margin so the padded draft still clears the floor if repair drops a
  // content-dependent line (e.g. an intro line it treats as a list marker).
  const targetLines = minimumBareLyricsLines(draftPlan) + 3;
  for (let index = 0; fixedLines + countedPadded() < targetLines && index < 400; index += 1) {
    const target = padTargets[index % padTargets.length];
    if (target.lines.length < target.cap) {
      target.lines.push(`よるのノイズがまだきえないから${index}`);
    }
  }
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

function hookTextFromLyrics(lyrics: string): string | undefined {
  const hook = parseLyricsSections(lyrics).find((section) => /^(?:final\s+)?hook\b/i.test(section.tag.trim()));
  if (!hook) return undefined;
  const text = hook.lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 180);
  return text || undefined;
}

function recentHookTexts(entries: Array<{ hookText?: string }>): string[] {
  return entries
    .map((entry) => entry.hookText?.trim())
    .filter((hook): hook is string => Boolean(hook))
    .filter((hook, index, hooks) => hooks.indexOf(hook) === index)
    .slice(0, 4);
}

function emotionalModeFromBrief(briefText: string): string | undefined {
  return briefText.match(/^\s*-\s*Mood:\s*(.+)$/im)?.[1]?.trim() || undefined;
}

async function composeLyricsDraft(input: DraftLyricsInput, title: string, briefText: string): Promise<LyricsDraft> {
  const provider = input.aiReviewProvider ?? input.config?.aiReview?.provider ?? "mock";
  const mind = await readArtistMind(input.workspaceRoot);
  const knowledgeDigest = await readLyricsKnowledgeDigest();
  const identity = await getArtistIdentity(input.workspaceRoot);
  const languagePolicy = parseLyricsLanguagePolicy(mind.artist);
  const lyricsBoxLimit = getSunoLyricsLimit();
  const lyricBodyLimit = lyricBodyLimitForSunoBox(lyricsBoxLimit);
  // Recent creative-quality window; reused for intro anti-repeat (legacy songs),
  // the dopagaki decision, and hook avoidance so we read the ledger once.
  const recentQuality = await readCreativeQualityLedger(input.workspaceRoot, 8);
  // The creative decision was made once by the director and persisted as
  // song-plan.json. This stage READS it — the intro, dopagaki, tempo band, and
  // emotional-mode label all come from the plan rather than being re-hashed here.
  // Songs created before the spine shipped have no plan; those fall back to the
  // previous per-axis computation.
  const plan = await readSongPlan(input.workspaceRoot, input.songId);
  let introVariant: IntroVariant;
  if (plan) {
    introVariant =
      buildIntroVariantById(plan.intro.archetype, `intro:${plan.seed}`) ??
      resolveIntroVariant(`intro:${input.songId}\n${briefText}`);
  } else {
    // Legacy: rotate the archetype from the ledger history (most-recent last so
    // the immediately previous archetype is excluded).
    const recentIntroArchetypes = recentQuality
      .map((entry) => entry.introArchetype)
      .filter((id): id is string => Boolean(id))
      .reverse();
    introVariant = resolveIntroVariant(`intro:${input.songId}\n${briefText}`, recentIntroArchetypes);
  }
  const tempoBand = plan ? plan.tempo.band : resolveTempoBandFromBrief(briefText);
  const durationPlan = getDurationPlan(tempoBand, {
    intro: {
      bars: introVariant.bars,
      lineFloor: introVariant.lineFloor,
      lineTarget: introVariant.lineTarget,
      modifier: introVariant.modifier,
      lyricInstruction: introVariant.lyricInstruction
    }
  });
  const emotionalMode = plan ? plan.emotionalMode.label : emotionalModeFromBrief(briefText);
  const minimumBareChars = minimumBareLyricsChars(durationPlan);
  const minimumBareLines = minimumBareLyricsLines(durationPlan);
  const dopagakiDecision = plan
    ? { threshold: plan.dopagaki.threshold, variationSeed: plan.dopagaki.variationSeed, active: plan.dopagaki.active, intensity: (plan.dopagaki.active ? "overt" : "off") as "overt" | "off", score: 0 }
    : decideDopagakiVariation({
        songId: input.songId,
        briefText,
        recentModes: recentQuality.map((entry) => entry.tempoBand === "dopagaki" || entry.dopagakiActive ? "dopagaki" : "spacious")
      });
  // DurationPlan is the resolved timing contract for this draft. Its band,
  // rather than an independent random choice, owns whether density is active.
  const dopagakiVariation = {
    ...dopagakiDecision,
    active: durationPlan.tempoBand === "dopagaki",
    intensity: durationPlan.tempoBand === "dopagaki" ? "overt" as const : "off" as const
  };
  const avoidedHooks = recentHookTexts(recentQuality);
  // Telemetry only: a ledger write must never fail lyric generation. Metrics are
  // recomputed from the passed lyrics so the stashed softened draft records its
  // own body, not a later attempt's.
  const recordCreativeQuality = async (draft: LyricsDraft, repairedLyrics: string, softened: boolean): Promise<void> => {
    const dissBankHits = computeDissBankHits(mind.artist, repairedLyrics);
    await appendCreativeQualityEntry(input.workspaceRoot, {
      songId: input.songId,
      title: draft.title,
      createdAt: new Date().toISOString(),
      dopagakiActive: dopagakiVariation.active,
      dopagakiThreshold: dopagakiVariation.threshold,
      bareLyricsChars: bareLyricsCharsForDraft(repairedLyrics),
      bareLines: bareLyricsLinesForDraft(repairedLyrics),
      moodHint: draft.moodHint,
      hookText: hookTextFromLyrics(repairedLyrics),
      tempoBand: durationPlan.tempoBand,
      emotionalMode,
      introArchetype: introVariant.id,
      decision: plan ?? undefined,
      dissBankHits,
      dissBankHitCount: dissBankHits.length,
      degraded: false,
      ...(softened ? { softened: true } : {})
    }).catch(() => undefined);
  };
  // A valid-but-softened draft is stashed rather than parked: if the single
  // regeneration attempt does not clear the softener (or later attempts come
  // back invalid), the stash is passed through with softened:true instead of
  // throwing a degradation.
  let softenerRetryUsed = false;
  let softenedStash: { draft: LyricsDraft; repaired: string } | undefined;
  let repairNotes: string[] = input.correctionGuidance ?? [];
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
      dopagakiVariation,
      durationPlan,
      recentHookTexts: avoidedHooks,
      decision: plan ?? undefined
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
      const softenerHit = SOFTENER_PATTERN.test(repaired);
      // Softener lint: one regeneration attempt when a softening phrase appears.
      if (softenerHit && !softenerRetryUsed) {
        softenerRetryUsed = true;
        softenedStash = { draft: finalDraft, repaired };
        repairNotes = [SOFTENER_REPAIR_NOTE];
        continue;
      }
      await recordCreativeQuality(finalDraft, repaired, softenerHit);
      return finalDraft;
    }
    repairNotes = validation.issues.map((issue) => `${issue.code}: ${issue.message}`).slice(0, 5);
  }
  // The regeneration attempt did not yield a clean valid draft, but a valid
  // softened draft exists. Pass it through with softened:true rather than
  // parking the song.
  if (softenedStash) {
    await recordCreativeQuality(softenedStash.draft, softenedStash.repaired, true);
    return softenedStash.draft;
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
    if (!input.deferDegradedNotification) {
      emitRuntimeEvent({ type: "lyrics_generation_degraded", songId: input.songId, reason, detail, repairNotes, timestamp: Date.now() });
      await updateSongState(input.workspaceRoot, input.songId, {
        degradedLyrics: true,
        reason,
        status: "brief"
      });
    }
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
