import type { AiReviewProvider } from "../types.js";
import { callAiProvider, isAiProviderMockFallbackResponse } from "../services/aiProviderClient.js";
import { buildStyleSynthesisPrompt } from "./styleSynthesisPrompt.js";
import { KNOWLEDGE_BUNDLE } from "./knowledge-bundle.js";
import { STYLE_TEMPLATES, type Genre } from "./styleTemplates.js";

export interface BuildStyleInput {
  artistProfile?: string;
  brief?: string;
  moodHint?: string;
  genre?: string;
  bpm?: number;
  key?: string;
  vibe?: string;
  vocalDescriptor?: string;
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
  return splitTags(input.moodHint ?? input.vibe ?? "observational dusk").slice(0, 2).join(" ") || "observational dusk";
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
  const vibe = compact(input.vibe ?? inferMood(input));
  const genre = inferGenre(input);
  const template = STYLE_TEMPLATES[genre] ?? STYLE_TEMPLATES.default;
  const instruments = input.instruments ?? inferInstruments(input);
  const tags = uniq([
    vibe,
    genre,
    `BPM ${Math.round(input.bpm ?? 124)}`,
    input.key ?? "minor key",
    inferMood(input),
    input.vocalDescriptor ?? "close dry vocal",
    ...(instruments.length > 0 ? instruments : template.instruments).slice(0, 3),
    input.mixKeyword ?? "intimate mix",
    vibe
  ]);
  const coreTags = fitTags(tags, 120);
  const direction = compact(input.performanceDirection ?? "Keep performance restrained, intelligible, and image-led; avoid arena-pop exaggeration.").slice(0, 100);
  const injectedInstruments = uniq([...instruments, ...template.instruments]).slice(0, 7);
  const vocabulary = [
    "wide stereo",
    "close-mic",
    "vocal-forward",
    "bass-heavy",
    "full arrangement"
  ].filter((term) => KNOWLEDGE_BUNDLE["style_catalog.md"].toLowerCase().includes(term));
  const render = (arrangement: string[]) => [
    "# Style",
    "",
    vibe,
    "",
    `- BPM: ${Math.round(input.bpm ?? 124)}`,
    `- Key: ${input.key ?? "minor key"}`,
    "- Signature: 4/4",
    "",
    `- Genre & Era: ${template.genreLine}`,
    `- Instruments: ${injectedInstruments.join(", ")}`,
    `- Mix Vision: ${template.mixVision.join(", ")}`,
    `- Texture: ${template.texture.join(", ")}`,
    `- Vocal Production: ${template.vocalProduction.join(", ")}`,
    `- Arrangement Notes: ${arrangement.join("; ")}`,
    `- Performance Direction: ${direction}`,
    `- Knowledge Vocabulary: ${vocabulary.join(", ")}`,
    "",
    vibe
  ].join("\n");
  const arrangement = [...template.arrangementNotes];
  let total = render(arrangement);
  const padding = [
    "Keep each section specific rather than generic",
    "let instruments answer the lyric image",
    "preserve vocal intelligibility over density",
    "keep the final hook wider without crowd noise"
  ];
  while (total.length < 900 && padding.length > 0) {
    arrangement.push(padding.shift() as string);
    total = render(arrangement);
  }
  while (total.length > 1000 && arrangement.length > 1) {
    arrangement.pop();
    total = render(arrangement);
  }
  if (total.length > 1000) {
    const suffix = `\n${vibe}`;
    total = `${total.slice(0, 1000 - suffix.length).trimEnd()}${suffix}`;
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
  const total = text.slice(0, 1000);
  const coreSource = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !/^#/.test(line))
    .join(", ");
  const coreTags = fitTags(splitTags(coreSource), 120);
  return { coreTags: coreTags || fitTags(splitTags(total), 120), total };
}

export async function synthesizeStyle(input: BuildStyleInput, options: StyleAiSynthesisOptions = {}): Promise<BuildStyleResult> {
  if (!options.provider || options.provider === "mock") {
    return buildStyle(input);
  }
  const prompt = await buildStyleSynthesisPrompt(input);
  const raw = await callAiProvider([prompt.system, "", prompt.user].join("\n"), { provider: options.provider });
  return normalizeAiStyle(raw) ?? buildStyle(input);
}
