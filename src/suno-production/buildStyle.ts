import type { AiReviewProvider } from "../types.js";
import { callAiProvider, isAiProviderMockFallbackResponse } from "../services/aiProviderClient.js";
import { buildStyleSynthesisPrompt } from "./styleSynthesisPrompt.js";
import { KNOWLEDGE_BUNDLE } from "./knowledge-bundle.js";
import { STYLE_TEMPLATES, type Genre } from "./styleTemplates.js";

export const CANONICAL_STYLE_CORE_MAX_CHARS = 120;
export const CANONICAL_STYLE_TARGET_MAX_CHARS = 400;
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
  return value.replace(/[.;:]/g, ",").replace(/\s+/g, " ").trim();
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

function inferGenre(input: BuildStyleInput): Genre {
  const source = `${input.genre ?? ""} ${input.brief ?? ""} ${input.artistProfile ?? ""}`.toLowerCase();
  if (/nu.?jazz/.test(source) && /rap|hip.?hop/.test(source)) return "nu-jazz rap";
  if (/rap|hip.?hop/.test(source)) return "rap";
  if (/jazz|nu.?jazz/.test(source)) return "nu-jazz rap";
  if (/edm|club|dance/.test(source)) return "edm";
  if (/rock|post.?punk/.test(source)) return "post-punk";
  return "alternative pop";
}

function inferMood(input: BuildStyleInput): string {
  const tags = splitTags(input.moodHint ?? input.vibe ?? "observational dusk")
    .slice(0, 2)
    .map((tag) => fitPhrase(tag, 48));
  return tags.filter(Boolean).join(", ") || "observational dusk";
}

function inferInstruments(input: BuildStyleInput): string[] {
  const source = `${input.brief ?? ""} ${input.artistProfile ?? ""}`.toLowerCase();
  const candidates = [
    ["Rhodes", /\brhodes\b/],
    ["sax", /\bsax(?:ophone)?\b/],
    ["upright bass", /\bupright bass\b/],
    ["brushed drums", /\bbrushed drums?\b|\bbrushes\b/],
    ["warm bass", /\bwarm bass\b/],
    ["cold synth", /\bcold synth\b/],
    ["glass synth", /\bglass synth\b/]
  ] as const;
  return candidates.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

export function buildStyle(input: BuildStyleInput): BuildStyleResult {
  const vibe = fitPhrase(input.vibe ?? inferMood(input), 40);
  const genre = inferGenre(input);
  const template = STYLE_TEMPLATES[genre] ?? STYLE_TEMPLATES.default;
  const bpm = Math.round(input.bpm ?? 124);
  const instruments = input.instruments ?? inferInstruments(input);
  const gender = input.vocalGender ?? "male";
  const vocalDescriptor = input.vocalDescriptor ?? (gender === "female" ? "close dry female vocal" : gender === "neutral" ? "close dry neutral lead vocal" : "mid-range male rap vocal");
  const tags = uniq([
    genre,
    vibe,
    `BPM ${bpm}`,
    vocalDescriptor,
    ...(instruments.length > 0 ? instruments : template.instruments).slice(0, 3),
    input.mixKeyword ?? "intimate mix"
  ]);
  const coreTags = fitTags(tags, CANONICAL_STYLE_CORE_MAX_CHARS);
  const direction = trimAtPhraseBoundary(compact(input.performanceDirection ?? "Keep performance restrained, intelligible, and image-led; no double-time vocal."), 76);
  const injectedInstruments = uniq([...instruments, ...template.instruments]).slice(0, 5);
  const vocabulary = [
    "wide stereo",
    "close-mic",
    "vocal-forward",
    "bass-heavy",
    "full arrangement"
  ].filter((term) => KNOWLEDGE_BUNDLE["style_catalog.md"].toLowerCase().includes(term));
  const render = (includeArrangement: boolean, includeTexture: boolean) => [
    "# Style",
    "",
    coreTags,
    `- Performance: ${direction}`,
    `- Instruments: ${trimAtPhraseBoundary(injectedInstruments.join(", "), 92)}`,
    `- Texture: ${trimAtPhraseBoundary(uniq([...template.texture, ...template.mixVision, ...vocabulary]).slice(0, 3).join(", "), 96)}`,
    includeArrangement ? `- Arrangement: ${trimAtPhraseBoundary(template.arrangementNotes.slice(0, 2).join("; "), 112)}` : undefined,
    includeTexture ? `- Production: ${trimAtPhraseBoundary(template.vocalProduction.slice(0, 2).join(", "), 78)}` : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");
  let total = render(true, true);
  if (total.length > CANONICAL_STYLE_TARGET_MAX_CHARS) {
    total = render(false, true);
  }
  if (total.length > CANONICAL_STYLE_TARGET_MAX_CHARS) {
    total = render(false, false);
  }
  if (total.length > CANONICAL_STYLE_TARGET_MAX_CHARS) {
    total = trimAtPhraseBoundary(total, CANONICAL_STYLE_TARGET_MAX_CHARS);
  }
  if (total.length > CANONICAL_STYLE_HARD_MAX_CHARS) {
    total = trimAtPhraseBoundary(total, CANONICAL_STYLE_HARD_MAX_CHARS);
  }
  return { coreTags, performanceDirection: direction, total };
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
  let total = trimAtPhraseBoundary(text, CANONICAL_STYLE_HARD_MAX_CHARS);
  if (total.length > CANONICAL_STYLE_TARGET_MAX_CHARS) {
    total = trimAtPhraseBoundary(total, CANONICAL_STYLE_TARGET_MAX_CHARS);
  }
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
