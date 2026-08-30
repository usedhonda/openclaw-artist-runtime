import type { AiReviewProvider } from "../types.js";
import { callAiProvider, isAiProviderMockFallbackResponse } from "../services/aiProviderClient.js";
import { buildStyleSynthesisPrompt } from "./styleSynthesisPrompt.js";

export const CANONICAL_STYLE_CORE_MAX_CHARS = 120;
export const CANONICAL_STYLE_TARGET_MIN_CHARS = 760;
export const CANONICAL_STYLE_TARGET_MAX_CHARS = 960;
export const CANONICAL_STYLE_HARD_MAX_CHARS = 1000;

export interface BuildStyleInput {
  artistProfile?: string;
  brief?: string;
  moodHint?: string;
  genre?: string;
  bpm?: number;
  key?: string;
  vibe?: string;
  vocalDescriptor?: string;
  vocalGender?: "male" | "female" | "neutral";
  instruments?: string[];
  mixKeyword?: string;
  performanceDirection?: string;
  variationSeed?: string;
  // --- CreativeDecision-derived hints (all optional; render-only) ---
  //
  // Role separation of the two mood strings (documented deliberately):
  //   - moodHint      = 音色ヒント (mood-hint.txt): timbre/production color. Drives
  //                     genre, vibe, YAML meta.vibe, and sliders — unchanged.
  //   - emotionalModeSpec = 感情 (CreativeDecision.emotionalMode.spec): the emotional
  //                     mode (e.g. 本気 Dis). The lyric prompt already consumes it via
  //                     the brief "- Mood:" line; here it reaches the style too so the
  //                     arrangement mood and the lyric mood come from one decision.
  emotionalModeSpec?: string;
  // Producer brief "- Style notes:" — an explicit style direction the brief writer
  // set but that buildStyle historically dropped. Rendered as one bounded hint line.
  styleNotes?: string;
  // The lyric opening's direction. It is an artist-authored constraint, not a
  // selector into a style-profile pool.
  introStyleMove?: string;
}

export interface BuildStyleResult {
  coreTags: string;
  performanceDirection?: string;
  total: string;
}

export interface StyleAiSynthesisOptions {
  provider?: AiReviewProvider;
}

function compact(value: string): string {
  return value
    .replace(/[.;:]/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/^,\s*|\s*,\s*$/g, "")
    .trim();
}

function splitTags(value: string): string[] {
  return compact(value)
    .split(/,|\band\b|\bwith\b|\bfeaturing\b/i)
    .map((token) => token.trim().replace(/^(a|an|the)\s+/i, ""))
    .filter(Boolean);
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function acousticBassAvoidanceRequested(input: BuildStyleInput): boolean {
  const source = [
    input.artistProfile,
    input.brief,
    input.moodHint,
    input.genre,
    input.vibe,
    input.performanceDirection
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(no|avoid|exclude|without|remove|removed|not|must not contain)\b[^.]*\b(upright|wood|acoustic double|double|acoustic)\s*-?\s*bass\b/.test(source)
    || /\b(upright|wood|acoustic double|double|acoustic)\s*-?\s*bass\b[^.]*\b(not|avoid|exclude|remove|removed|forbid|forbidden)\b/.test(source);
}

function fitTags(tags: string[], max: number): string {
  const fitted: string[] = [];
  for (const tag of tags) {
    const next = [...fitted, tag].join(", ");
    if (next.length > max) {
      continue;
    }
    fitted.push(tag);
  }
  return fitted.join(", ");
}

function fitPhrase(value: string, max: number): string {
  return trimAtPhraseBoundary(compact(value), max);
}

function englishStylePhrase(value: string | undefined, fallback: string): string {
  const translated = (value ?? "")
    .replace(/\u30c9\u30d1\u30ac\u30ad/g, "high-velocity progressive rap")
    .replace(/[^\x20-\x7E]/g, " ");
  return compact(translated) || fallback;
}

function trimAtPhraseBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const head = text.slice(0, maxLength);
  const boundaryPatterns = [/\n-\s[^\n]*$/, /\n[^\n]*$/, /[.;,]\s+[^.;,\n]*$/, /\s+[A-Za-z0-9'-]*$/];
  for (const pattern of boundaryPatterns) {
    const match = head.match(pattern);
    if (match?.index && match.index >= Math.floor(maxLength * 0.65)) {
      return head.slice(0, match.index).trimEnd();
    }
  }
  return head.replace(/[A-Za-z0-9'-]+$/, "").trimEnd() || head.trimEnd();
}

function inferGenre(input: BuildStyleInput): string {
  const source = `${input.genre ?? ""} ${input.brief ?? ""} ${input.artistProfile ?? ""}`.toLowerCase();
  if (/nu.?jazz/.test(source) && /rap|hip.?hop/.test(source)) return "nu-jazz rap";
  if (/rap|hip.?hop/.test(source)) return "rap";
  if (/jazz|nu.?jazz/.test(source)) return "nu-jazz rap";
  if (/edm|club|dance/.test(source)) return "edm";
  if (/rock|post.?punk/.test(source)) return "post-punk";
  return "alternative pop";
}

function inferMood(input: BuildStyleInput): string {
  const tags = splitTags(englishStylePhrase(input.moodHint ?? input.vibe, "observational dusk"))
    .slice(0, 2)
    .map((tag) => fitPhrase(tag, 48));
  return tags.filter(Boolean).join(", ") || "observational dusk";
}

function inferInstruments(input: BuildStyleInput): string[] {
  const source = `${input.brief ?? ""} ${input.artistProfile ?? ""} ${input.moodHint ?? ""} ${input.genre ?? ""} ${input.vibe ?? ""}`.toLowerCase();
  const excludesAcousticBass = acousticBassAvoidanceRequested(input);
  const candidates = [
    ["Rhodes", /\brhodes\b/],
    ["sax", /\bsax(?:ophone)?\b/],
    ...(excludesAcousticBass ? [] : [["upright bass", /\bupright bass\b/]] as const),
    ["thick electric bass", /\belectric bass\b|\bsolid-body bass\b/],
    ["brushed drums", /\bbrushed drums?\b|\bbrushes\b/],
    ["warm bass", /\bwarm bass\b/],
    ["cold synth", /\bcold synth\b/],
    ["glass synth", /\bglass synth\b/]
  ] as const;
  return candidates.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

// A bounded, English-only, sanitized hint line for the style body. Non-ASCII
// (e.g. a fully-Japanese style note) sanitizes to empty and the line is omitted.
function styleHintLine(label: string, value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const phrase = fitPhrase(englishStylePhrase(value, ""), max);
  return phrase ? `- ${label}: ${phrase}.` : undefined;
}

// The decision's opening direction, sanitized for the neutral fallback formatter.
function resolveIntroMove(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const phrase = compact(englishStylePhrase(value, ""));
  return phrase || undefined;
}

export function buildStyle(input: BuildStyleInput): BuildStyleResult {
  const vibe = fitPhrase(englishStylePhrase(input.vibe, inferMood(input)), 40);
  const genre = inferGenre(input);
  const bpm = Math.round(input.bpm ?? 124);
  const instruments = input.instruments ?? inferInstruments(input);
  const gender = input.vocalGender ?? "male";
  const vocalDescriptor = input.vocalDescriptor ?? (gender === "female" ? "close dry female vocal" : gender === "neutral" ? "close dry neutral lead vocal" : "mid-range male rap vocal");
  const tags = uniq([
    genre,
    vibe,
    `BPM ${bpm}`,
    vocalDescriptor,
    ...(instruments.length > 0 ? instruments : ["drums", "bass", "keys"]),
    input.mixKeyword ?? "intimate mix"
  ]);
  const coreTags = fitTags(tags, CANONICAL_STYLE_CORE_MAX_CHARS);
  const direction = trimAtPhraseBoundary(compact(input.performanceDirection ?? "Keep performance restrained, intelligible, and image-led; no double-time vocal."), 76);
  const emotionalModeLine = styleHintLine("Emotional Mode", input.emotionalModeSpec, 64);
  const styleNotesLine = styleHintLine("Style Notes", input.styleNotes, 80);
  const introMove = resolveIntroMove(input.introStyleMove) ?? "opening follows the lyric section tag";
  const injectedInstruments = uniq([
    ...instruments,
    ...(instruments.length > 0 ? [] : ["drums", "bass", "keys"])
  ]);
  // This path is only used when the AI style writer is unavailable. It carries
  // submitted facts forward without inventing an alternate arrangement arc.
  const total = [
    "# Style",
    "",
    coreTags,
    `- Genre & Tempo: ${genre}, ${bpm} BPM.`,
    `- Vocal Production: ${vocalDescriptor}.`,
    `- Instruments: ${injectedInstruments.join(", ")}.`,
    emotionalModeLine,
    styleNotesLine,
    `- Opening: ${introMove}.`,
    `- Performance: ${direction}`
  ].filter((line): line is string => Boolean(line)).join("\n");
  return { coreTags, performanceDirection: direction, total };
}

// The prompt-pack validator requires the first non-header content line of the
// styleAndFeel block to stay within CANONICAL_STYLE_CORE_MAX_CHARS. The
// deterministic buildStyle() always emits a fitted `coreTags` line first, but the
// AI synthesis path (normalizeAiStyle) can return a long run-on first line (e.g.
// 931 chars), which used to fail-closed and pause autopilot. This deterministic
// repair guarantees the contract by inserting a fitted core line ahead of any
// oversized first content line, preserving the original text as the body below it.
export function enforceStyleCoreContract(style: string): string {
  const lines = style.split(/\r?\n/);
  const contentIdx = lines.findIndex((line) => {
    const normalized = line.replace(/^[-*]\s*/, "").trim();
    return normalized.length > 0 && !/^#\s*Style\b/i.test(normalized);
  });
  if (contentIdx < 0) {
    return style;
  }
  const firstContent = lines[contentIdx].replace(/^[-*]\s*/, "").trim();
  if (firstContent.length <= CANONICAL_STYLE_CORE_MAX_CHARS) {
    return style;
  }
  const coreTags = fitTags(splitTags(firstContent), CANONICAL_STYLE_CORE_MAX_CHARS)
    || trimAtPhraseBoundary(firstContent, CANONICAL_STYLE_CORE_MAX_CHARS);
  const rebuilt = [
    ...lines.slice(0, contentIdx),
    coreTags,
    lines[contentIdx],
    ...lines.slice(contentIdx + 1)
  ].join("\n");
  return rebuilt.length > CANONICAL_STYLE_HARD_MAX_CHARS
    ? trimAtPhraseBoundary(rebuilt, CANONICAL_STYLE_HARD_MAX_CHARS)
    : rebuilt;
}

function normalizeAiStyle(raw: string): BuildStyleResult | undefined {
  const text = raw
    .replace(/```(?:text)?/gi, "")
    .replace(/```/g, "")
    .replace(/^#\s*Style\s*/im, "")
    .trim();
  if (!text || isAiProviderMockFallbackResponse(text)) {
    return undefined;
  }
  const total = trimAtPhraseBoundary(text, CANONICAL_STYLE_HARD_MAX_CHARS);
  const coreSource = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !/^#/.test(line))
    .join(", ");
  const coreTags = fitTags(splitTags(coreSource), CANONICAL_STYLE_CORE_MAX_CHARS);
  return { coreTags: coreTags || fitTags(splitTags(total), CANONICAL_STYLE_CORE_MAX_CHARS), total };
}

export async function synthesizeStyle(input: BuildStyleInput, options: StyleAiSynthesisOptions = {}): Promise<BuildStyleResult> {
  if (!options.provider || options.provider === "mock") {
    return buildStyle(input);
  }
  const prompt = await buildStyleSynthesisPrompt(input);
  const raw = await callAiProvider([prompt.system, "", prompt.user].join("\n"), { provider: options.provider });
  return normalizeAiStyle(raw) ?? buildStyle(input);
}
