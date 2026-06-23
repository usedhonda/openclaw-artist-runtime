import { createHash } from "node:crypto";
import { extractLyricsBody } from "../services/lyricsExtraction.js";
import { lintJapaneseLyricsEnglishFragments, lintResidualKanji, normalizeAsciiNumbersToHiragana } from "../services/lyricsLanguageLint.js";
import { repairCommandLeak } from "../services/lyricsRepair.js";
import type { AiReviewProvider, CreateSunoPromptPackInput, SunoPromptPack, SunoSliders } from "../types.js";
import { getSunoLyricsLimit } from "../services/runtimeConfig.js";
import { validateSunoPromptPack } from "../validators/promptPackValidator.js";
import { buildExclude as buildExcludeV55 } from "./buildExclude.js";
import { synthesizeExclude } from "./buildExclude.js";
import { buildSliders as buildSlidersV55 } from "./buildSliders.js";
import {
  CANONICAL_STYLE_HARD_MAX_CHARS,
  CANONICAL_STYLE_TARGET_MAX_CHARS,
  buildStyle as buildStyleV55
} from "./buildStyle.js";
import { synthesizeStyle } from "./buildStyle.js";
import { buildYaml as buildYamlV55 } from "./buildYaml.js";
import {
  durationPlanCues,
  durationPlanProductionNotes,
  getDurationPlan
} from "./durationPlan.js";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildPayload(input: CreateSunoPromptPackInput, style: string, exclude: string, yamlLyrics: string, sliders: SunoSliders, lyricsBoxLimit: number): Record<string, unknown> {
  const lyricsBody = extractLyricsBody(yamlLyrics);
  const languageWarnings = [
    ...lintJapaneseLyricsEnglishFragments(lyricsBody).map((warning) => `english_fragment:${warning.token}:line_${warning.line}`),
    ...lintResidualKanji(lyricsBody).map((warning) => `${warning.kind ?? "residual_kanji"}:${warning.token}:line_${warning.line}`)
  ];
  return {
    songId: input.songId,
    songName: input.songTitle,
    artistReason: input.artistReason,
    styleAndFeel: style,
    excludeStyles: exclude,
    lyrics: lyricsBody,
    lyricsText: lyricsBody,
    payloadYaml: yamlLyrics,
    lyricsYaml: yamlLyrics,
    sliders,
    promptCharCounts: promptCharCounts(input.songTitle, style, lyricsBody, yamlLyrics, lyricsBoxLimit),
    languageWarnings
  };
}

function artistDefaultVocalGender(artistSnapshot: string): "male" | "female" | "neutral" {
  const match = artistSnapshot.match(/(?:^|\n)\s*(?:[-*]\s*)?(?:gender|vocalGender)\s*:\s*(male|female|neutral)\b/i);
  return (match?.[1]?.toLowerCase() as "male" | "female" | "neutral" | undefined) ?? "male";
}

function promptCharCounts(title: string, style: string, lyrics: string, payloadYaml: string, lyricsBoxLimit: number) {
  const durationPlan = getDurationPlan();
  const styleLength = style.length;
  const lyricsLength = lyrics.length;
  const titleLength = title.length;
  const submittedPayloadChars = payloadYaml.length;
  const markerChars = Math.max(0, submittedPayloadChars - lyricsLength);
  return {
    style: styleLength,
    lyrics: lyricsLength,
    title: titleLength,
    bareLyricsChars: lyricsLength,
    markerChars,
    submittedPayloadChars,
    effectiveLyricsBoxLimit: lyricsBoxLimit,
    plannedBars: durationPlan.totalPlannedBars,
    durationTargetSeconds: durationPlan.targetSeconds,
    styleZone: styleLength > CANONICAL_STYLE_HARD_MAX_CHARS ? "overflow" : styleLength > CANONICAL_STYLE_TARGET_MAX_CHARS ? "long" : styleLength < 40 ? "short" : "sweet",
    lyricsZone: submittedPayloadChars > lyricsBoxLimit ? "overflow" : submittedPayloadChars < lyricsBoxLimit * 0.8 ? "underused" : "near_max",
    titleZone: titleLength < 4 ? "short" : titleLength > 80 ? "overflow" : "sweet"
  };
}

export function createSunoPromptPack(input: CreateSunoPromptPackInput): SunoPromptPack {
  const lyricsText = normalizeAsciiNumbersToHiragana(repairCommandLeak(input.lyricsText).trim());
  const genre = `${input.artistReason} ${input.moodHint ?? ""}`;
  const durationPlan = getDurationPlan();
  const bpm = input.bpm ?? durationPlan.bpm.target;
  const vocalGender = input.vocalGender ?? artistDefaultVocalGender(input.artistSnapshot);
  const lyricsBoxLimit = getSunoLyricsLimit();
  const styleResult = buildStyleV55({
    artistProfile: input.artistSnapshot,
    brief: input.artistReason,
    moodHint: input.moodHint,
    genre,
    vibe: input.moodHint,
    bpm,
    vocalGender
  });
  const style = styleResult.total;
  const exclude = buildExcludeV55({
    genre,
    artistAvoid: ["generic EDM drop", "fake crowd noise"],
    copyrightSourceNameDenylist: [input.songTitle]
  }).text;
  const yamlLyrics = buildYamlV55({
    title: input.songTitle,
    lyrics: lyricsText,
    meta: {
      tempo: bpm,
      key: "minor",
      signature: "4/4",
      form: durationPlan.form,
      vibe: input.moodHint ?? "observational dusk",
      language: "ja"
    },
    vocals: {
      parts: [
        { id: "lead", gender: vocalGender, tone: vocalGender === "male" ? "mid-range male rap, close, dry, intelligible" : "close, dry, intelligible" },
        { id: "hook_double", gender: vocalGender, tone: "restrained width only on repeated hook lines" }
      ],
      rules: [
        "keep doubles restrained and intelligible",
        "let consonants stay forward over bass movement",
        "no double-time vocal; leave breath between lines"
      ]
    },
    production_notes: [
      ...durationPlanProductionNotes(durationPlan),
      "bass forward, restrained drums, no novelty genre pivot",
      "leave enough midrange space for dense Japanese phrasing"
    ],
    notes: [
      "original lyrics and style only; no source-name imitation",
      "metadata describes delivery; lyrics body remains the singable text"
    ],
    cues: durationPlanCues(durationPlan),
    lyricsBoxLimit,
    durationPlan
  });
  const sliders = buildSlidersV55({ genre, moodHint: input.moodHint });
  const payload = buildPayload({ ...input, lyricsText, bpm, vocalGender }, style, exclude, yamlLyrics, sliders, lyricsBoxLimit);
  const payloadHash = hashText(JSON.stringify(payload));
  const promptHash = hashText(`${style}\n${exclude}\n${yamlLyrics}`);
  const artistSnapshotHash = hashText(input.artistSnapshot);
  const currentStateHash = hashText(input.currentStateSnapshot);
  const knowledgePackHash = hashText(input.knowledgePackVersion ?? "knowledge-pack:unknown");

  const pack: SunoPromptPack = {
    songId: input.songId,
    songTitle: input.songTitle,
    artistReason: input.artistReason,
    lyricsBundle: {
      lyricsText,
      yamlLyrics,
      moodHint: input.moodHint
    },
    style,
    exclude,
    yamlLyrics,
    sliders,
    payload,
    validation: { valid: true, errors: [] },
    promptHash,
    payloadHash,
    artistSnapshotHash,
    currentStateHash,
    knowledgePackHash
  };

  pack.validation = validateSunoPromptPack(pack);
  return pack;
}

export async function createSunoPromptPackWithAi(
  input: CreateSunoPromptPackInput & { aiReviewProvider?: AiReviewProvider }
): Promise<SunoPromptPack> {
  const lyricsText = repairCommandLeak(input.lyricsText).trim();
  const genre = `${input.artistReason} ${input.moodHint ?? ""}`;
  const durationPlan = getDurationPlan();
  const bpm = input.bpm ?? durationPlan.bpm.target;
  const vocalGender = input.vocalGender ?? artistDefaultVocalGender(input.artistSnapshot);
  const lyricsBoxLimit = getSunoLyricsLimit();
  const styleResult = await synthesizeStyle({
    artistProfile: input.artistSnapshot,
    brief: input.artistReason,
    moodHint: input.moodHint,
    genre,
    vibe: input.moodHint,
    bpm,
    vocalGender
  }, { provider: input.aiReviewProvider });
  const excludeResult = await synthesizeExclude({
    genre,
    artistAvoid: ["generic EDM drop", "fake crowd noise"],
    copyrightSourceNameDenylist: [input.songTitle]
  }, { provider: input.aiReviewProvider });
  const yamlLyrics = buildYamlV55({
    title: input.songTitle,
    lyrics: lyricsText,
    meta: {
      tempo: bpm,
      key: "minor",
      signature: "4/4",
      form: durationPlan.form,
      vibe: input.moodHint ?? "observational dusk",
      language: "ja"
    },
    vocals: {
      parts: [
        { id: "lead", gender: vocalGender, tone: vocalGender === "male" ? "mid-range male rap, close, dry, intelligible" : "close, dry, intelligible" },
        { id: "hook_double", gender: vocalGender, tone: "restrained width only on repeated hook lines" }
      ],
      rules: [
        "keep doubles restrained and intelligible",
        "let consonants stay forward over bass movement",
        "no double-time vocal; leave breath between lines"
      ]
    },
    production_notes: [
      ...durationPlanProductionNotes(durationPlan),
      "bass forward, restrained drums, no novelty genre pivot",
      "leave enough midrange space for dense Japanese phrasing"
    ],
    notes: [
      "original lyrics and style only; no source-name imitation",
      "metadata describes delivery; lyrics body remains the singable text"
    ],
    cues: durationPlanCues(durationPlan),
    lyricsBoxLimit,
    durationPlan
  });
  const sliders = buildSlidersV55({ genre, moodHint: input.moodHint });
  const payload = buildPayload({ ...input, lyricsText, bpm, vocalGender }, styleResult.total, excludeResult.text, yamlLyrics, sliders, lyricsBoxLimit);
  const payloadHash = hashText(JSON.stringify(payload));
  const promptHash = hashText(`${styleResult.total}\n${excludeResult.text}\n${yamlLyrics}`);
  const artistSnapshotHash = hashText(input.artistSnapshot);
  const currentStateHash = hashText(input.currentStateSnapshot);
  const knowledgePackHash = hashText(input.knowledgePackVersion ?? "knowledge-pack:unknown");
  const pack: SunoPromptPack = {
    songId: input.songId,
    songTitle: input.songTitle,
    artistReason: input.artistReason,
    lyricsBundle: {
      lyricsText,
      yamlLyrics,
      moodHint: input.moodHint
    },
    style: styleResult.total,
    exclude: excludeResult.text,
    yamlLyrics,
    sliders,
    payload,
    validation: { valid: true, errors: [] },
    promptHash,
    payloadHash,
    artistSnapshotHash,
    currentStateHash,
    knowledgePackHash
  };
  pack.validation = validateSunoPromptPack(pack);
  return pack;
}
