import { createHash } from "node:crypto";
import { extractLyricsBody } from "../services/lyricsExtraction.js";
import { lintJapaneseLyricsEnglishFragments, lintResidualKanji, normalizeSunoRegistrationJapanese } from "../services/lyricsLanguageLint.js";
import { repairCommandLeak } from "../services/lyricsRepair.js";
import type { AiReviewProvider, CreateSunoPromptPackInput, SunoPromptPack, SunoSliders } from "../types.js";
import { getSunoLyricsLimit } from "../services/runtimeConfig.js";
import { parseLyricsLanguagePolicy } from "../services/lyricsLanguagePolicy.js";
import { validateSunoPromptPack } from "../validators/promptPackValidator.js";
import { buildExclude as buildExcludeV55 } from "./buildExclude.js";
import { synthesizeExclude } from "./buildExclude.js";
import { buildSliders as buildSlidersV55 } from "./buildSliders.js";
import {
  CANONICAL_STYLE_HARD_MAX_CHARS,
  CANONICAL_STYLE_TARGET_MAX_CHARS,
  buildStyle as buildStyleV55,
  enforceStyleCoreContract
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
    model: "v6",
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

function acousticBassAvoidanceTerms(source: string): string[] {
  return /\b(upright|wood|acoustic double|double|acoustic)\s*-?\s*bass\b/i.test(source)
    ? ["upright bass", "acoustic double bass", "wood bass", "walking acoustic jazz bass", "muddy round bass", "acoustic bass"]
    : [];
}

export function sanitizeAcousticBassStyle(style: string, acousticBassAvoidance: string[]): string {
  if (acousticBassAvoidance.length === 0) return style;
  return style
    .replace(/\bfat upright bass\b/gi, "hard-pick solid-body electric bass")
    .replace(/\bupright bass\b/gi, "hard-pick solid-body electric bass")
    .replace(/\bacoustic double bass\b/gi, "hard-pick solid-body electric bass")
    .replace(/\bwalking acoustic jazz bass\b/gi, "tight electric bass line")
    .replace(/\bwood bass\b/gi, "clear DI electric bass")
    .replace(/\bacoustic bass\b/gi, "clear DI electric bass")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\s+,/g, ",")
    .trim();
}

export function sanitizeAcousticBassExclude(exclude: string, acousticBassAvoidance: string[]): string {
  if (acousticBassAvoidance.length === 0) return exclude;
  const items = [...acousticBassAvoidance, ...exclude.split(",")]
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  return [...new Set(items)].join(", ").slice(0, 240);
}

export function classifyLyricsZoneForPromptCounts(
  lyricsLength: number,
  markerChars: number,
  submittedPayloadChars: number,
  lyricsBoxLimit: number
): "underused" | "near_max" | "overflow" {
  if (submittedPayloadChars > lyricsBoxLimit) return "overflow";
  const bareLyricsCapacity = Math.max(1, lyricsBoxLimit - markerChars);
  return lyricsLength < bareLyricsCapacity * 0.8 ? "underused" : "near_max";
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
    lyricsZone: classifyLyricsZoneForPromptCounts(lyricsLength, markerChars, submittedPayloadChars, lyricsBoxLimit),
    titleZone: titleLength < 4 ? "short" : titleLength > 80 ? "overflow" : "sweet"
  };
}

export function createSunoPromptPack(input: CreateSunoPromptPackInput): SunoPromptPack {
  const originalLyricsText = repairCommandLeak(input.lyricsText).trim();
  const lyricsText = normalizeSunoRegistrationJapanese(originalLyricsText);
  const genre = `${input.artistReason} ${input.moodHint ?? ""}`;
  const acousticBassAvoidance = acousticBassAvoidanceTerms(genre);
  const durationPlan = getDurationPlan(input.tempoBand, {
    structure: input.creativeDecision?.structure ?? "standard"
  });
  const bpm = input.bpm ?? durationPlan.bpm.target;
  const vocalGender = input.vocalGender ?? input.creativeDecision?.vocalGender ?? artistDefaultVocalGender(input.artistSnapshot);
  const languagePolicy = parseLyricsLanguagePolicy(input.artistSnapshot);
  const lyricsBoxLimit = getSunoLyricsLimit();
  const styleResult = buildStyleV55({
    artistProfile: input.artistSnapshot,
    brief: input.artistReason,
    moodHint: input.moodHint,
    genre,
    vibe: input.moodHint,
    bpm,
    vocalGender,
    variationSeed: input.styleVariationSeed,
    // variationSeed already carries plan.dopagaki.variationSeed (both pack call
    // sites pass it as styleVariationSeed), so the variation profile is plan-seeded.
    emotionalModeSpec: input.creativeDecision?.emotionalMode.spec,
    styleNotes: input.styleNotes,
    introStyleMove: input.creativeDecision?.intro.styleMove
  });
  const style = sanitizeAcousticBassStyle(enforceStyleCoreContract(styleResult.total), acousticBassAvoidance);
  const exclude = buildExcludeV55({
    genre,
    artistAvoid: [...acousticBassAvoidance, "generic EDM drop", "fake crowd noise"],
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
      language: languagePolicy.yamlLanguage
    },
    vocals: {
      parts: [
        { id: "lead", gender: vocalGender, tone: vocalGender === "male" ? "mid-range male rap, close, dry, intelligible" : "close, dry, intelligible" },
        { id: "hook_double", gender: vocalGender, tone: "restrained width only on repeated hook lines" }
      ],
      rules: [
        "keep doubles restrained and intelligible",
        "let consonants stay forward over bass movement",
        durationPlan.bpm.noDoubleTimeVocal
          ? "no double-time vocal; leave breath between lines"
          : "double-time bursts allowed on the densest verse and hook bars; keep consonants intelligible"
      ]
    },
    production_notes: [
      ...durationPlanProductionNotes(durationPlan),
      "bass forward, restrained drums, no novelty genre pivot",
      "leave enough midrange space for dense Japanese phrasing"
    ],
    notes: [
      "original lyrics and style only; no source-name imitation",
      "metadata describes delivery; lyrics body remains the singable text",
      languagePolicy.instruction
    ],
    cues: durationPlanCues(durationPlan),
    lyricsBoxLimit,
    durationPlan
  });
  const sliders = buildSlidersV55({ genre, moodHint: input.moodHint, weirdnessOverride: input.weirdnessOverride });
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
      originalLyricsText,
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

  pack.validation = validateSunoPromptPack(pack, input.creativeDecision?.structure ?? "standard");
  return pack;
}

export interface ProductionPromptPackOverrides {
  basePack?: SunoPromptPack;
  direction?: string;
  inheritedDirection?: string;
  excludeStyles?: string[];
}

function replaceProductionTempo(text: string, bpm: number): string {
  return text.replace(/\b(?:\d{2,3}\s*BPM|BPM\s*\d{2,3})\b/gi, (tempo) => tempo.replace(/\d{2,3}/, String(bpm)));
}

function renderProductionTempo(yaml: string, bpm: number): string {
  // The canonical renderer separates non-sung metadata from the lyrics body.
  // Refuse an unknown boundary instead of treating sung words as instructions.
  const boundary = /^(?:=== LYRICS START(?: \(do not sing tags\))? ===|LYRICS START)\r?\n([\s\S]*?)^(?:=== LYRICS END ===|LYRICS END)[ \t]*$/m.exec(yaml);
  if (!boundary) throw new Error("production tempo revision requires explicit lyrics boundaries");
  const metadata = yaml.slice(0, boundary.index).split("\n").map((line) => {
    if (/^\s*title:/.test(line)) return line;
    return replaceProductionTempo(line, bpm).replace(/^(\s*(?:tempo|bpm_target):\s*)\d{2,3}\b/i, `$1${bpm}`);
  }).join("\n");
  const lyrics = boundary[1].split("\n").map((line) =>
    /^\s*\[(?:Intro|Verse|Hook|Chorus|Bridge|Outro|Pre[- ]Chorus|Pre[- ]Hook|Final Hook|Final Chorus|Instrumental|Break|Solo)\b[^\]\r\n]*\]\s*$/i.test(line)
      ? replaceProductionTempo(line, bpm) : line
  ).join("\n");
  const rendered = boundary[0].replace(boundary[1], () => lyrics);
  return metadata + rendered + yaml.slice(boundary.index + boundary[0].length);
}

/** Production-only overlay used by producer revisions.  It deliberately reuses
 * the canonical generator, while making the producer direction part of the
 * style brief and replacing exclusions in the submitted payload. */
export function createProductionRevisionPromptPack(
  input: CreateSunoPromptPackInput,
  overrides: ProductionPromptPackOverrides
): SunoPromptPack {
  if (overrides.basePack) {
    const base = overrides.basePack;
    const title = input.songTitle;
    const bpm = input.bpm;
    const direction = overrides.direction?.trim();
    let style = base.style;
    if (direction && !style.toLowerCase().includes(direction.toLowerCase())) {
      if (style.length + direction.length + 2 > CANONICAL_STYLE_HARD_MAX_CHARS) throw new Error("production direction exceeds style limit");
      style = `${style}, ${direction}`;
    }
    if (bpm !== undefined) style = replaceProductionTempo(style, bpm);
    let yamlLyrics = base.yamlLyrics;
    if (title !== base.songTitle) yamlLyrics = yamlLyrics.replace(/(^|\n)(\s*title:\s*).+$/im, `$1$2${title}`);
    if (bpm !== undefined) yamlLyrics = renderProductionTempo(yamlLyrics, bpm);
    const lyricsText = extractLyricsBody(yamlLyrics);
    if (overrides.excludeStyles && overrides.excludeStyles.join(", ").length > 240) throw new Error("production exclusions exceed 240 characters");
    const exclude = overrides.excludeStyles?.length ? overrides.excludeStyles.join(", ") : base.exclude;
    const previousCounts = (base.payload.promptCharCounts ?? {}) as Record<string, unknown>;
    const payload = {
      ...base.payload,
      songName: title,
      styleAndFeel: style,
      excludeStyles: exclude,
      payloadYaml: yamlLyrics,
      lyricsYaml: yamlLyrics,
      lyrics: lyricsText,
      lyricsText,
      promptCharCounts: {
        ...previousCounts,
        style: style.length,
        title: title.length,
        submittedPayloadChars: yamlLyrics.length,
        lyrics: lyricsText.length
      }
    };
    const pack: SunoPromptPack = {
      ...base,
      songTitle: title,
      style,
      exclude,
      yamlLyrics,
      lyricsBundle: { ...base.lyricsBundle, lyricsText, yamlLyrics },
      payload,
      promptHash: hashText(`${style}\n${exclude}\n${yamlLyrics}`),
      payloadHash: hashText(JSON.stringify(payload))
    };
    pack.validation = validateSunoPromptPack(pack, "standard");
    if (!pack.validation.valid) throw new Error(`production revision prompt pack invalid: ${pack.validation.errors.join("; ")}`);
    return pack;
  }
  const direction = overrides.direction?.trim();
  const pack = createSunoPromptPack({
    ...input,
    artistReason: direction ? `${input.artistReason}; arrangement direction: ${direction}` : input.artistReason
  });
  if (direction && !pack.style.toLowerCase().includes(direction.toLowerCase())) {
    if (pack.style.length + direction.length + 2 > CANONICAL_STYLE_HARD_MAX_CHARS) throw new Error("production direction exceeds style limit");
    pack.style = `${pack.style}, ${direction}`;
    pack.payload = { ...pack.payload, styleAndFeel: pack.style };
  }
  if (overrides.excludeStyles && overrides.excludeStyles.length > 0) {
    const exclude = [...new Set(overrides.excludeStyles.map((item) => item.trim()).filter(Boolean))].join(", ").slice(0, 240);
    pack.exclude = exclude;
    pack.payload = { ...pack.payload, excludeStyles: exclude };
    pack.promptHash = hashText(`${pack.style}\n${pack.exclude}\n${pack.yamlLyrics}`);
    pack.payloadHash = hashText(JSON.stringify(pack.payload));
  }
  const counts = (pack.payload.promptCharCounts ?? {}) as Record<string, unknown>;
  pack.payload = {
    ...pack.payload,
    promptCharCounts: {
      ...counts,
      style: pack.style.length,
      title: pack.songTitle.length,
      submittedPayloadChars: pack.yamlLyrics.length,
      lyrics: typeof pack.payload.lyrics === "string" ? pack.payload.lyrics.length : counts.lyrics
    }
  };
  pack.promptHash = hashText(`${pack.style}\n${pack.exclude}\n${pack.yamlLyrics}`);
  pack.payloadHash = hashText(JSON.stringify(pack.payload));
  pack.validation = validateSunoPromptPack(pack, "standard");
  if (!pack.validation.valid) throw new Error(`production revision prompt pack invalid: ${pack.validation.errors.join("; ")}`);
  return pack;
}

export async function createSunoPromptPackWithAi(
  input: CreateSunoPromptPackInput & { aiReviewProvider?: AiReviewProvider }
): Promise<SunoPromptPack> {
  const originalLyricsText = repairCommandLeak(input.lyricsText).trim();
  const lyricsText = normalizeSunoRegistrationJapanese(originalLyricsText);
  const genre = `${input.artistReason} ${input.moodHint ?? ""}`;
  const acousticBassAvoidance = acousticBassAvoidanceTerms(genre);
  const durationPlan = getDurationPlan(input.tempoBand, {
    structure: input.creativeDecision?.structure ?? "standard"
  });
  const bpm = input.bpm ?? durationPlan.bpm.target;
  const vocalGender = input.vocalGender ?? input.creativeDecision?.vocalGender ?? artistDefaultVocalGender(input.artistSnapshot);
  const languagePolicy = parseLyricsLanguagePolicy(input.artistSnapshot);
  const lyricsBoxLimit = getSunoLyricsLimit();
  const styleResult = await synthesizeStyle({
    artistProfile: input.artistSnapshot,
    brief: input.artistReason,
    moodHint: input.moodHint,
    genre,
    vibe: input.moodHint,
    bpm,
    vocalGender,
    variationSeed: input.styleVariationSeed,
    // variationSeed already carries plan.dopagaki.variationSeed (both pack call
    // sites pass it as styleVariationSeed), so the variation profile is plan-seeded.
    emotionalModeSpec: input.creativeDecision?.emotionalMode.spec,
    styleNotes: input.styleNotes,
    introStyleMove: input.creativeDecision?.intro.styleMove
  }, { provider: input.aiReviewProvider });
  const excludeResult = await synthesizeExclude({
    genre,
    artistAvoid: [...acousticBassAvoidance, "generic EDM drop", "fake crowd noise"],
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
      language: languagePolicy.yamlLanguage
    },
    vocals: {
      parts: [
        { id: "lead", gender: vocalGender, tone: vocalGender === "male" ? "mid-range male rap, close, dry, intelligible" : "close, dry, intelligible" },
        { id: "hook_double", gender: vocalGender, tone: "restrained width only on repeated hook lines" }
      ],
      rules: [
        "keep doubles restrained and intelligible",
        "let consonants stay forward over bass movement",
        durationPlan.bpm.noDoubleTimeVocal
          ? "no double-time vocal; leave breath between lines"
          : "double-time bursts allowed on the densest verse and hook bars; keep consonants intelligible"
      ]
    },
    production_notes: [
      ...durationPlanProductionNotes(durationPlan),
      "bass forward, restrained drums, no novelty genre pivot",
      "leave enough midrange space for dense Japanese phrasing"
    ],
    notes: [
      "original lyrics and style only; no source-name imitation",
      "metadata describes delivery; lyrics body remains the singable text",
      languagePolicy.instruction
    ],
    cues: durationPlanCues(durationPlan),
    lyricsBoxLimit,
    durationPlan
  });
  const sliders = buildSlidersV55({ genre, moodHint: input.moodHint, weirdnessOverride: input.weirdnessOverride });
  const style = sanitizeAcousticBassStyle(enforceStyleCoreContract(styleResult.total), acousticBassAvoidance);
  const exclude = sanitizeAcousticBassExclude(excludeResult.text, acousticBassAvoidance);
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
      originalLyricsText,
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
  pack.validation = validateSunoPromptPack(pack, input.creativeDecision?.structure ?? "standard");
  return pack;
}
