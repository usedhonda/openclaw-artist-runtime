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

const ACOUSTIC_BASS_TERMS = [
  "upright bass",
  "acoustic double bass",
  "double bass",
  "wood bass",
  "walking acoustic jazz bass",
  "acoustic bass",
  "fat upright bass"
];

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

function removeAcousticBassTerms(values: string[]): string[] {
  return values.filter((value) => !ACOUSTIC_BASS_TERMS.some((term) => value.toLowerCase().includes(term)));
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
  intro: string[];
}

const variationProfiles: StyleVariationProfile[] = [
  {
    id: "progressive-overt",
    line: "Variation Move: overt high-velocity progressive rap; 2-4 bar technical fast-flow bursts, compressed sections, metric displacement, motivated transitions, rhythmic switch-ups, motif callbacks, transformed hook returns.",
    arrangement: ["compressed section turns", "metric displacement at boundaries", "2-4 bar technical fast-flow bursts", "transformed final hook return"],
    mix: ["dry transient definition", "bass-forward rhythmic pressure", "Rhodes and horn punctuation at turns", "controlled density without festival scale"],
    texture: ["live-room drum grain", "Rhodes shadow detail", "tight rhythmic counter-motifs"],
    intro: ["cold intro, immediate pocket", "hard downbeat intro, no runway", "count-in straight into the burst"]
  },
  {
    id: "progressive-core",
    line: "Variation Move: core high-velocity progressive rap; rapid but intelligible section development, rhythmic cell changes at musical boundaries, recurring motifs, jazz-rap continuity, and a final hook that returns with changed meaning while preserving the natural mid-range male lead.",
    arrangement: ["rapid section development", "rhythmic cell changes at boundaries", "recurring motif callback", "changed-meaning final hook"],
    mix: ["dry transient definition", "bass-forward pocket", "controlled density without digital gloss"],
    texture: ["live-room drum grain", "Rhodes shadow detail"],
    intro: ["instrumental motif intro, short runway", "brief Rhodes intro then the pocket", "count-in into the groove"]
  },
  {
    id: "percussive-negative-space",
    line: "Variation Move: percussion-led negative space; clipped rim details, bass answered by dry room hits, hook widened by rhythm rather than extra chords, bridge drops to breath and low percussion, final hook returns with tighter drum geometry.",
    arrangement: ["clipped rim details", "bass-and-drum call response", "rhythm-widened hook", "bridge breath drop", "tighter final drum geometry"],
    mix: ["dry punch", "hard panned small percussion", "low-mid pocket discipline"],
    texture: ["wood-and-metal transient grain", "short room reflections"],
    intro: ["sparse percussion intro, negative space", "rim-click intro then hard downbeat", "silence then a drum hit intro"]
  },
  {
    id: "nocturnal-jazz-shift",
    line: "Variation Move: nocturnal jazz color shift; Rhodes voicings answer the vocal, sax or horn fragments appear only at section turns, chorus keeps the same pulse but changes chord color, bridge thins to bass harmonics before the final hook.",
    arrangement: ["Rhodes answer phrases", "horn fragments at section turns", "chorus chord-color shift", "bass-harmonic bridge", "final hook motif return"],
    mix: ["warm low-mid bloom", "close jazz-room depth", "soft analog glue"],
    texture: ["brushed cymbal grain", "dim club air"],
    intro: ["atmospheric Rhodes fade intro", "muted horn intro, dim room", "brushed-cymbal intro, unhurried"]
  },
  {
    id: "cold-electro-pulse",
    line: "Variation Move: cold electro pulse; sub movement stays restrained, arpeggio fragments rotate every section, hook gains width through stereo automation, bridge narrows to mono pressure, final hook reopens with sharper side motion.",
    arrangement: ["rotating arp fragments", "restrained sub movement", "stereo-automated hook", "mono-pressure bridge", "reopened final hook"],
    mix: ["clean side motion", "precise low-end envelope", "cold stereo automation"],
    texture: ["glass synth shimmer", "humid warehouse edge"],
    intro: ["arpeggio fragment intro, cold fade-in", "sub-pulse intro, stereo widening", "glassy synth intro, sparse"]
  },
  {
    id: "dusty-live-contrast",
    line: "Variation Move: dusty live contrast; organic bass and drums carry the verses, synth or key texture appears as a shadow, hook widens without arena scale, bridge exposes room noise, final hook restores the main groove with one new countermelody.",
    arrangement: ["organic verse groove", "shadow synth or key texture", "non-arena hook width", "room-noise bridge", "final countermelody"],
    mix: ["live-room intimacy", "vocal-forward center", "unpolished transient edges"],
    texture: ["tape dust", "small-room air"],
    intro: ["room-noise intro, organic bass first", "spoken cue intro then the groove", "tape-dust intro, live-room air"]
  }
];

function variationProfile(input: BuildStyleInput): StyleVariationProfile {
  const source = `${input.variationSeed ?? ""}\n${input.artistProfile ?? ""}\n${input.brief ?? ""}\n${input.moodHint ?? ""}\n${input.vibe ?? ""}`;
  const progressiveIdentity = /high-velocity progressive rap|progressive architecture|structural density|metric displacement/i.test(source);
  const legacyVariation = /\bdopagaki\b|\bdopamine\b|\bhigh stimulus\b/i.test(source) || source.includes("\u30c9\u30d1\u30ac\u30ad");
  if (
    /\b(overt|strong|hard|max(?:imum)?|explicit|full)\b/i.test(source)
    || /露骨|強め|濃い|全開|はっきり|ガッツリ|ごりごり|ゴリゴリ/.test(source)
  ) {
    if (legacyVariation || progressiveIdentity) {
      return variationProfiles[0];
    }
  }
  // Ordinary progressive-identity songs (the artist profile always carries
  // "high-velocity progressive rap" / "metric displacement") must not collapse
  // to one fixed profile. Only an explicit overt/dopagaki override above pins a
  // progressive profile; everything else hash-rotates across all six.
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

export function buildStyle(input: BuildStyleInput): BuildStyleResult {
  const vibe = fitPhrase(englishStylePhrase(input.vibe, inferMood(input)), 40);
  const genre = inferGenre(input);
  const template = STYLE_TEMPLATES[genre] ?? STYLE_TEMPLATES.default;
  const templateInstruments = acousticBassAvoidanceRequested(input)
    ? removeAcousticBassTerms(template.instruments)
    : template.instruments;
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
    ...(instruments.length > 0 ? instruments : templateInstruments).slice(0, 3),
    input.mixKeyword ?? "intimate mix"
  ]);
  const coreTags = fitTags(tags, CANONICAL_STYLE_CORE_MAX_CHARS);
  const direction = trimAtPhraseBoundary(compact(input.performanceDirection ?? "Keep performance restrained, intelligible, and image-led; no double-time vocal."), 76);
  const injectedInstruments = uniq([
    ...instruments,
    ...richList(uniq([...instruments, ...templateInstruments]), seedHash, 7)
  ]);
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
        `- Intro Move: ${pickOne(profile.intro, seedHash, 23)}.`,
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
      `- Intro Move: ${pickOne(profile.intro, seedHash, 23)}.`,
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
