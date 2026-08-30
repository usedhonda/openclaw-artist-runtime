import { createHash } from "node:crypto";
import {
  CRITIQUE_LENS_HEADING,
  EMOTIONAL_MODES_HEADING,
  headingMatches
} from "./personaHeadings.js";

export const DOPAGAKI_TARGET_RATE = 0.4;

export interface EmotionalMode {
  label: string;
  mood: string;
}

const FALLBACK_EMOTIONAL_MODES: readonly EmotionalMode[] = [
  { label: "風刺", mood: "sharp satire, dry wit, civic pressure" },
  { label: "郷愁", mood: "nostalgic, warm-cold, late-night recall" },
  { label: "祝祭", mood: "celebratory, bright tension, crowded momentum" },
  { label: "自嘲", mood: "self-mocking, cool restraint, after-hours clarity" },
  { label: "賛美", mood: "admiring, vivid, open-hearted momentum" },
  { label: "静かな肯定", mood: "quiet affirmation, spacious resolve, dawn calm" }
];

export interface DopagakiVariationDecision {
  active: boolean;
  intensity: "off" | "overt";
  score: number;
  threshold: number;
  variationSeed: string;
}

export interface DopagakiVariationInput {
  songId: string;
  date?: string;
  observationText?: string;
  briefText?: string;
  recentModes?: Array<"dopagaki" | "spacious">;
  targetRate?: number;
}

export function hashRatio(value: string): number {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return Number.parseInt(hash, 16) / 0xffffffff;
}

export function bulletSection(artistMd: string, heading: string): string[] {
  const lines = artistMd.split(/\r?\n/);
  const start = lines.findIndex((line) => headingMatches(line, heading));
  if (start < 0) return [];
  const values: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const bullet = line.trim().match(/^-\s+(.+)$/);
    if (bullet?.[1]) values.push(bullet[1].trim());
  }
  return values;
}

export function emotionalModesFromArtist(artistMd: string): EmotionalMode[] {
  const parsed = bulletSection(artistMd, EMOTIONAL_MODES_HEADING)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator < 1) return undefined;
      const label = line.slice(0, separator).trim();
      const mood = line.slice(separator + 1).trim();
      return label && mood ? { label, mood } : undefined;
    })
    .filter((mode): mode is EmotionalMode => Boolean(mode));
  return parsed.length > 0 ? parsed : [...FALLBACK_EMOTIONAL_MODES];
}

export function pickEmotionalMode(
  seed: string,
  modes: readonly EmotionalMode[],
  recentModes: readonly string[] = []
): EmotionalMode {
  const available = modes.length > 0 ? modes : FALLBACK_EMOTIONAL_MODES;
  const start = Math.floor(hashRatio(seed) * available.length) % available.length;
  const latest = recentModes.at(-1);
  const index = available.length > 1 && available[start].label === latest
    ? (start + 1) % available.length
    : start;
  return available[index];
}

const TEMPO_BANDS = [
  { band: "slow", bpm: 88, weight: 1 },
  { band: "mid", bpm: 108, weight: 2 },
  { band: "up", bpm: 122, weight: 4 },
  { band: "dopagaki", bpm: 138, weight: 3 },
  { band: "super", bpm: 148, weight: 2 }
] as const;

export type RotatingTempoBand = (typeof TEMPO_BANDS)[number]["band"];

export function pickTempoBand(seed: string): RotatingTempoBand {
  const totalWeight = TEMPO_BANDS.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = hashRatio(seed) * totalWeight;
  for (const entry of TEMPO_BANDS) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.band;
  }
  return TEMPO_BANDS.at(-1)!.band;
}

export function pickTempoBpm(seed: string): number {
  const band = pickTempoBand(seed);
  return TEMPO_BANDS.find((entry) => entry.band === band)!.bpm;
}

// Canonical BPM for a named tempo band. Used when an explicit band override
// (operator/API) must be reflected in the creative decision's tempo.
export function bpmForTempoBand(band: RotatingTempoBand): number {
  return TEMPO_BANDS.find((entry) => entry.band === band)?.bpm ?? TEMPO_BANDS[1].bpm;
}

function clampRate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function adjustedThreshold(input: DopagakiVariationInput): number {
  const base = clampRate(input.targetRate ?? DOPAGAKI_TARGET_RATE);
  const recent = input.recentModes ?? [];
  if (recent.length >= 3 && recent.slice(-3).every((mode) => mode !== "dopagaki")) {
    return clampRate(base + 0.2);
  }
  if (recent.length >= 2 && recent.slice(-2).every((mode) => mode === "dopagaki")) {
    return clampRate(base - 0.2);
  }
  return base;
}

export function decideDopagakiVariation(input: DopagakiVariationInput): DopagakiVariationDecision {
  const seedSource = [
    input.songId,
    input.date ?? "",
    input.observationText ?? "",
    input.briefText ?? ""
  ].join("\n");
  const score = hashRatio(seedSource || input.songId);
  const threshold = adjustedThreshold(input);
  const active = score < threshold;
  const variationSeed = active
    ? `dopagaki:overt:${input.songId}:${score.toFixed(4)}`
    : `spacious:${input.songId}:${score.toFixed(4)}`;
  return {
    active,
    intensity: active ? "overt" : "off",
    score,
    threshold,
    variationSeed
  };
}

export function appendDopagakiMoodHint(base: string | undefined, decision: DopagakiVariationDecision): string | undefined {
  if (!decision.active) return base;
  const prefix = base?.trim() || "aggressive urban critique";
  return `${prefix}, high-velocity progressive rap, overt structural density, compressed section turns, technical fast-flow burst`;
}

export function dopagakiPromptLines(decision?: DopagakiVariationDecision): string[] {
  if (!decision?.active) {
    return [
      "High-velocity progressive rap: core motion is always active; overt density mode is inactive for this song.",
      "Keep rapid section development, metric displacement, motif callbacks, and jazz-rap continuity; reserve double-density delivery for selected 2-4 bar passages."
    ];
  }
  return [
    "High-velocity progressive rap: ACTIVE / OVERT for this song.",
    "Use compressed sections, metric displacement, abrupt but motivated transitions, rhythmic switch-ups, motif callbacks, transformed hook returns, and technical fast-flow bursts inside the live nu-jazz rap core.",
    "Limit high-speed or double-density delivery to 2-4 bar bursts. Never turn the full song into double-time.",
    "Keep live breakbeat jazz drums, thick electric bass, Rhodes, tense horn punctuation, and the dry intelligible mid-range male vocal identity intact."
  ];
}

// The director chooses the song's subject, stance, tempo, structure, and hook.
// It must not also choose from a menu of nearly-identical openings: that turns
// the first bars into a detectable template. The lyric writer owns each new
// opening; this contract only prevents Suno from filling an empty lead section
// with wordless vocalise.
export interface IntroVariant {
  id: string;
  entryMode: "artist_led" | "voice_led" | "music_led" | "rhythm_led";
  bars: number;
  lineFloor: number;
  lineTarget: string;
  modifier: string;
  lyricInstruction: string;
  styleMove: string;
}

const ARTIST_LED_OPENING: IntroVariant = {
  id: "artist_led",
  entryMode: "artist_led",
  bars: 2,
  lineFloor: 0,
  lineTarget: "artist-decided opening",
  modifier: "artist-decided opening: either a concrete instrumental gesture with no vocals, or one complete intelligible lyric line; never an empty vocal intro",
  lyricInstruction: "Choose the opening for this song from its observation and emotional turn. It may be instrumental only when the tag begins [Instrumental Intro] and has zero lyric lines; otherwise write exactly one complete, meaningful lyric line. Never use syllables, phonetic filler, vocal chops, ad-libs, a count-in, or an empty [Intro].",
  styleMove: "no intro ad-libs"
};

const INTRO_MOTIFS = [
  "piano motif",
  "Rhodes motif",
  "muted horn stab",
  "drum pickup",
  "upright bass walk"
] as const;

const INTRO_METERS = ["straight 4/4", "7/8", "triplet", "half-time"] as const;

// Ordered pool; index selection is a stable hash over this list.  These are not
// cosmetic labels: each one gives Suno a different first-eight-bars event and a
// different handoff into the body.  entryMode is deliberately separate from the
// id so two differently named, but sonically similar, no-vocal openings cannot
// keep following one another.
const INTRO_ARCHETYPES: ReadonlyArray<{ id: string; build: (seed: string) => IntroVariant }> = [
  {
    id: "scene_set",
    build: (seed) => {
      const variants = [
        { modifier: "2 bars, close-mic scene line over a bare bass pulse, drums answer on bar 3", lyricInstruction: "1 line; give one concrete image in a dry near-spoken voice, then let the full verse cut in." },
        { modifier: "2 bars, one visual line over a held Rhodes chord, beat enters late", lyricInstruction: "1 line; state one image without explaining it, leave a beat of air, then enter the verse." },
        { modifier: "3 bars, whispered scene line, horn answer, abrupt verse entry", lyricInstruction: "1 line; place one quiet image, let a horn answer it, then snap into the verse." }
      ];
      const pick = variants[Math.floor(hashRatio(`${seed}:scene`) * variants.length) % variants.length];
      return { id: "scene_set", entryMode: "voice_led", bars: 3, lineFloor: 1, lineTarget: "1 line", styleMove: "close-mic image, late-beat verse snap", ...pick };
    }
  },
  {
    id: "cold_open",
    build: () => ({
      id: "cold_open",
      entryMode: "voice_led",
      bars: 2,
      lineFloor: 1,
      lineTarget: "1 line",
      modifier: "2 bars, vocal cold open: clipped hook fragment on beat one, verse cuts in before it resolves",
      lyricInstruction: "1 line; start with a short hook fragment on the first beat, then interrupt it with the verse before it can settle.",
      styleMove: "vocal cold open; hook fragment cut by verse"
    })
  },
  {
    id: "instrumental",
    build: (seed) => {
      const motif = INTRO_MOTIFS[Math.floor(hashRatio(`${seed}:motif`) * INTRO_MOTIFS.length) % INTRO_MOTIFS.length];
      const meter = INTRO_METERS[Math.floor(hashRatio(`${seed}:meter`) * INTRO_METERS.length) % INTRO_METERS.length];
      return {
        id: "instrumental",
        entryMode: "music_led",
        bars: 3,
        lineFloor: 0,
        lineTarget: "0 lines",
        modifier: `3 bars, instrumental ${motif} in ${meter}, phrase cuts off before bar 4`,
        lyricInstruction: "0 lines; establish a short motif, cut it off mid-thought, and enter the verse against the missing fourth bar.",
        styleMove: "three-bar motif cut before resolution"
      };
    }
  },
  {
    id: "count_in",
    build: (seed) => {
      const meter = INTRO_METERS[Math.floor(hashRatio(`${seed}:meter`) * INTRO_METERS.length) % INTRO_METERS.length];
      return {
        id: "count_in",
        entryMode: "rhythm_led",
        bars: 1,
        lineFloor: 0,
        lineTarget: "0 lines",
        modifier: `1 bar, broken drum pickup in ${meter}, bass enters a beat late`,
        lyricInstruction: "0 lines; use a fractured drum pickup, then let the bass arrive late under the first verse line.",
        styleMove: "broken pickup, late bass arrival"
      };
    }
  },
  {
    id: "atmospheric",
    build: () => ({
      id: "atmospheric",
      entryMode: "music_led",
      bars: 3,
      lineFloor: 0,
      lineTarget: "0 lines",
      modifier: "3 bars, filtered pad swell with an exposed bass note; filter tears open into a dry drum break",
      lyricInstruction: "0 lines; let the texture swell without a melody, then tear it open into the first dry drum break.",
      styleMove: "filter rupture into dry drum break"
    })
  },
  {
    id: "spoken_cue",
    build: () => ({
      id: "spoken_cue",
      entryMode: "voice_led",
      bars: 2,
      lineFloor: 1,
      lineTarget: "1 line",
      modifier: "2 bars, spoken accusation with no backing chord; drums answer the final word",
      lyricInstruction: "1 line; speak one accusation plainly, leave the last word exposed, then let the drums answer it.",
      styleMove: "spoken accusation, drums answer last word"
    })
  },
  {
    id: "silence_hit",
    build: () => ({
      id: "silence_hit",
      entryMode: "rhythm_led",
      bars: 2,
      lineFloor: 1,
      lineTarget: "1 line",
      modifier: "2 bars, one beat of silence, vocal tag lands alone, band hits on its echo",
      lyricInstruction: "1 line; leave one beat silent, land a short vocal tag alone, then let the band hit on its echo.",
      styleMove: "silence, isolated tag, band echo"
    })
  }
];

// New songs use one artist-led contract, not an archetype rotation.  The
// arguments remain for compatibility with older callers and persisted plans.
export const INTRO_ARCHETYPE_IDS: readonly string[] = [ARTIST_LED_OPENING.id];

export function resolveIntroVariant(_seed: string, _recentArchetypes: readonly string[] = []): IntroVariant {
  return ARTIST_LED_OPENING;
}

// Rebuilds the full IntroVariant for a known archetype id and seed. Used by
// downstream stages to reconstruct the director's intro (bars / lineFloor /
// lineTarget) from the persisted plan, which stores only the archetype id plus
// the prompt-visible modifier and lyricInstruction. Passing the same seed the
// director used (`intro:${plan.seed}`) reproduces the identical variant.
export function buildIntroVariantById(id: string, seed: string): IntroVariant | undefined {
  if (id === ARTIST_LED_OPENING.id) return ARTIST_LED_OPENING;
  return INTRO_ARCHETYPES.find((entry) => entry.id === id)?.build(seed);
}

export function critiqueLensLines(artistMd: string): string[] {
  const lens = bulletSection(artistMd, CRITIQUE_LENS_HEADING);
  return [
    "Critique lens:",
    ...(lens.length > 0
      ? lens
      : ["Start from the actual news/X material and follow the systems, incentives, and culture that shape it. Keep the critique concrete, sharp, and artist-specific."]),
    "The diss target is systems, incentives, styles, cultures, industries, and public structures. Do not attack private individuals or protected traits.",
    "Make the critique sharper than neutral observation: laugh at the structure, then stab it with concrete images, internal rhyme, and one clean punchline turn."
  ];
}
