import type { AiReviewProvider } from "../types.js";
import { callAiProvider, isAiProviderMockFallbackResponse } from "../services/aiProviderClient.js";
import { buildStyleSynthesisPrompt } from "./styleSynthesisPrompt.js";
import { KNOWLEDGE_BUNDLE } from "./knowledge-bundle.js";
import { STYLE_TEMPLATES, type Genre } from "./styleTemplates.js";

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

function englishStylePhrase(value: string | undefined, fallback: string): string {
  const translated = (value ?? "")
    .replace(/\u30c9\u30d1\u30ac\u30ad/g, "dopagaki pressure")
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

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickOne<T>(items: T[], hash: number, offset = 0): T {
  return items[(hash + offset) % items.length];
}

interface StyleVariationProfile {
  id: string;
  line: string;
  arrangement: string[];
  mix: string[];
  texture: string[];
}

const variationProfiles: StyleVariationProfile[] = [
  {
    id: "dopagaki-lite",
    line: "Variation Move: light dopamine-pop pressure inside the existing genre; cold-open hook energy, fast earworm recall, 8-bar texture switches, post-hook counter-motif, one-beat bridge silence, and a final hook density lift while preserving the natural mid-range male lead.",
    arrangement: ["cold-open hook pressure", "8-bar texture switches", "post-hook counter-motif", "one-beat bridge silence", "final hook density lift"],
    mix: ["tight glossy transients", "front-loaded hook impact", "controlled loudness without festival scale"],
    texture: ["sharp playful top-line motion", "clean digital sparkle tucked into the existing palette"]
  },
  {
    id: "percussive-negative-space",
    line: "Variation Move: percussion-led negative space; clipped rim details, bass answered by dry room hits, hook widened by rhythm rather than extra chords, bridge drops to breath and low percussion, final hook returns with tighter drum geometry.",
    arrangement: ["clipped rim details", "bass-and-drum call response", "rhythm-widened hook", "bridge breath drop", "tighter final drum geometry"],
    mix: ["dry punch", "hard panned small percussion", "low-mid pocket discipline"],
    texture: ["wood-and-metal transient grain", "short room reflections"]
  },
  {
    id: "nocturnal-jazz-shift",
    line: "Variation Move: nocturnal jazz color shift; Rhodes voicings answer the vocal, sax or horn fragments appear only at section turns, chorus keeps the same pulse but changes chord color, bridge thins to bass harmonics before the final hook.",
    arrangement: ["Rhodes answer phrases", "horn fragments at section turns", "chorus chord-color shift", "bass-harmonic bridge", "final hook motif return"],
    mix: ["warm low-mid bloom", "close jazz-room depth", "soft analog glue"],
    texture: ["brushed cymbal grain", "dim club air"]
  },
  {
    id: "cold-electro-pulse",
    line: "Variation Move: cold electro pulse; sub movement stays restrained, arpeggio fragments rotate every section, hook gains width through stereo automation, bridge narrows to mono pressure, final hook reopens with sharper side motion.",
    arrangement: ["rotating arp fragments", "restrained sub movement", "stereo-automated hook", "mono-pressure bridge", "reopened final hook"],
    mix: ["clean side motion", "precise low-end envelope", "cold stereo automation"],
    texture: ["glass synth shimmer", "humid warehouse edge"]
  },
  {
    id: "dusty-live-contrast",
    line: "Variation Move: dusty live contrast; organic bass and drums carry the verses, synth or key texture appears as a shadow, hook widens without arena scale, bridge exposes room noise, final hook restores the main groove with one new countermelody.",
    arrangement: ["organic verse groove", "shadow synth or key texture", "non-arena hook width", "room-noise bridge", "final countermelody"],
    mix: ["live-room intimacy", "vocal-forward center", "unpolished transient edges"],
    texture: ["tape dust", "small-room air"]
  }
];

function variationProfile(input: BuildStyleInput): StyleVariationProfile {
  const source = `${input.variationSeed ?? ""}\n${input.artistProfile ?? ""}\n${input.brief ?? ""}\n${input.moodHint ?? ""}\n${input.vibe ?? ""}`;
  if (/\bdopagaki\b|\bdopamine\b|\bhigh stimulus\b/i.test(source) || source.includes("\u30c9\u30d1\u30ac\u30ad")) {
    return variationProfiles[0];
  }
  const seed = input.variationSeed ?? source;
  const hash = hashString(seed || "artist-runtime-style-variation");
  return pickOne(variationProfiles, hash);
}

function richList(items: string[], hash: number, maxItems: number): string[] {
  const rotated = items.map((item, index) => ({ item, score: hashString(`${hash}:${index}:${item}`) }))
    .sort((a, b) => a.score - b.score)
    .map(({ item }) => item);
  return uniq(rotated).slice(0, maxItems);
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
  const tags = splitTags(englishStylePhrase(input.moodHint ?? input.vibe, "observational dusk"))
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
  const vibe = fitPhrase(englishStylePhrase(input.vibe, inferMood(input)), 40);
  const genre = inferGenre(input);
  const template = STYLE_TEMPLATES[genre] ?? STYLE_TEMPLATES.default;
  const bpm = Math.round(input.bpm ?? 124);
  const seedHash = hashString(input.variationSeed ?? `${input.artistProfile ?? ""}\n${input.brief ?? ""}\n${input.moodHint ?? ""}\n${genre}\n${bpm}`);
  const profile = variationProfile(input);
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
  const injectedInstruments = richList(uniq([...instruments, ...template.instruments]), seedHash, 7);
  const vocabulary = [
    "wide stereo",
    "close-mic",
    "vocal-forward",
    "bass-heavy",
    "full arrangement"
  ].filter((term) => KNOWLEDGE_BUNDLE["style_catalog.md"].toLowerCase().includes(term));
  const render = (detailLevel: "full" | "compact") => {
    const mix = uniq([...template.mixVision, ...profile.mix, ...vocabulary]).slice(0, detailLevel === "full" ? 7 : 4).join(", ");
    const texture = uniq([...template.texture, ...profile.texture]).slice(0, detailLevel === "full" ? 6 : 3).join(", ");
    if (detailLevel === "compact") {
      const compactMix = uniq([...template.mixVision, ...profile.mix]).slice(0, 3).join(", ");
      const compactTexture = uniq([...template.texture, ...profile.texture]).slice(0, 2).join(", ");
      return [
        "# Style",
        "",
        coreTags,
        `- Genre & Era: ${genre}, ${bpm} BPM, minor; cool urban restraint.`,
        `- Vocal Production: ${vocalDescriptor}; dry intelligible lead, restrained doubles.`,
        `- Instruments: ${injectedInstruments.slice(0, 3).join(", ")}; ${profile.arrangement[0]}.`,
        `- Rhythm & Bass: ${pickOne(template.mixVision, seedHash, 11)}, ${pickOne(profile.mix, seedHash, 17)}; no double-time.`,
        `- Mix/Texture: ${compactMix.split(", ").slice(0, 2).join(", ")}; ${compactTexture.split(", ")[0]}; vocal-forward space.`,
        `- Arrangement Arc: ${template.arrangementNotes[0]}; ${profile.arrangement.slice(0, 2).join("; ")}.`,
        `- Performance: ${trimAtPhraseBoundary(direction, 52)}`,
        trimAtPhraseBoundary(profile.line, 165)
      ].filter((line): line is string => Boolean(line)).join("\n");
    }
    return [
      "# Style",
      "",
      coreTags,
      `- Genre & Era: ${template.genreLine}; keep the current artist core intact, observational, cool, urban, unsentimental.`,
      `- Vocal Production: ${vocalDescriptor}; ${template.vocalProduction.join(", ")}; natural lead identity, dry consonants, restrained doubles, no novelty character voice.`,
      `- Instruments: ${injectedInstruments.join(", ")}; ${profile.arrangement.slice(0, 3).join(", ")}.`,
      `- Rhythm & Bass: ${pickOne(template.mixVision, seedHash, 11)}, ${pickOne(profile.mix, seedHash, 17)}, bass movement supports Japanese phrasing without double-time vocal pressure.`,
      `- Mix Vision: ${mix}; vocal-forward center with enough negative space for dense lyrics.`,
      `- Texture: ${texture}.`,
      `- Arrangement Arc: ${template.arrangementNotes.join("; ")}; ${profile.arrangement.join("; ")}.`,
      `- Performance: ${direction}`,
      profile.line
    ].filter((line): line is string => Boolean(line)).join("\n");
  };
  let total = render("full");
  if (total.length > CANONICAL_STYLE_TARGET_MAX_CHARS) {
    total = render("compact");
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
