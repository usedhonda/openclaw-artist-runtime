import { createHash } from "node:crypto";

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
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
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
  const parsed = bulletSection(artistMd, "### Emotional Modes")
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

// Deterministic INTRO archetype rotation. The intro modifier is the strongest
// arrangement signal Suno reads from the lyrics-box [Intro - ...] tag, so rather
// than shipping every song with the same fixed "sparse scene" intro we rotate a
// seven-archetype pool by a stable hash of the song seed. Pure function: same
// seed -> same variant, no Math.random, no I/O.
export interface IntroVariant {
  id: string;
  bars: number;
  lineFloor: number;
  lineTarget: string;
  modifier: string;
  lyricInstruction: string;
}

const INTRO_MOTIFS = [
  "piano motif",
  "Rhodes motif",
  "muted horn stab",
  "drum pickup",
  "upright bass walk"
] as const;

const INTRO_METERS = ["straight 4/4", "7/8", "triplet", "half-time"] as const;

// Ordered pool; index selection is a stable hash over this list. Each builder
// may pull an independent sub-seed (":motif" / ":meter") so a rotating detail
// does not correlate with the archetype choice or the tempo/dopagaki seeds.
const INTRO_ARCHETYPES: ReadonlyArray<{ id: string; build: (seed: string) => IntroVariant }> = [
  {
    id: "scene_set",
    build: (seed) => {
      const variants = [
        { modifier: "4 bars, sparse scene, no rush", lyricInstruction: "0-1 line; establish the scene and do not start rushing." },
        { modifier: "4 bars, sparse scene, room to breathe", lyricInstruction: "0-1 line; sketch the opening scene with space around it and no rush." },
        { modifier: "4 bars, low-lit scene set, unhurried", lyricInstruction: "0-1 line; set a low-lit scene and hold back before the verse." }
      ];
      const pick = variants[Math.floor(hashRatio(`${seed}:scene`) * variants.length) % variants.length];
      return { id: "scene_set", bars: 4, lineFloor: 1, lineTarget: "0-1 line", ...pick };
    }
  },
  {
    id: "cold_open",
    build: () => ({
      id: "cold_open",
      bars: 2,
      lineFloor: 0,
      lineTarget: "0 lines",
      modifier: "2 bars, cold open, hard entry, no runway",
      lyricInstruction: "0 lines; enter immediately at full energy with no setup."
    })
  },
  {
    id: "instrumental",
    build: (seed) => {
      const motif = INTRO_MOTIFS[Math.floor(hashRatio(`${seed}:motif`) * INTRO_MOTIFS.length) % INTRO_MOTIFS.length];
      const meter = INTRO_METERS[Math.floor(hashRatio(`${seed}:meter`) * INTRO_METERS.length) % INTRO_METERS.length];
      return {
        id: "instrumental",
        bars: 4,
        lineFloor: 0,
        lineTarget: "0 lines",
        modifier: `4 bars, instrumental, ${motif}, ${meter} feel`,
        lyricInstruction: "0 lines; no vocals, establish the motif."
      };
    }
  },
  {
    id: "count_in",
    build: (seed) => {
      const meter = INTRO_METERS[Math.floor(hashRatio(`${seed}:meter`) * INTRO_METERS.length) % INTRO_METERS.length];
      return {
        id: "count_in",
        bars: 2,
        lineFloor: 0,
        lineTarget: "0 lines",
        modifier: `2 bars, count-in, ${meter} feel`,
        lyricInstruction: "0 lines; count-in then drop straight into the verse."
      };
    }
  },
  {
    id: "atmospheric",
    build: () => ({
      id: "atmospheric",
      bars: 4,
      lineFloor: 0,
      lineTarget: "0 lines",
      modifier: "4 bars, fade in, atmospheric pads, sparse",
      lyricInstruction: "0 lines; ambient fade in, minimal, let the pads breathe."
    })
  },
  {
    id: "spoken_cue",
    build: () => ({
      id: "spoken_cue",
      bars: 2,
      lineFloor: 1,
      lineTarget: "1 line",
      modifier: "2 bars, spoken word, single line",
      lyricInstruction: "1 line; one spoken line, dry, then the beat enters."
    })
  },
  {
    id: "silence_hit",
    build: () => ({
      id: "silence_hit",
      bars: 2,
      lineFloor: 0,
      lineTarget: "0 lines",
      modifier: "2 bars, silence then hard downbeat",
      lyricInstruction: "0 lines; negative space, then a hard entry on the downbeat."
    })
  }
];

export const INTRO_ARCHETYPE_IDS: readonly string[] = INTRO_ARCHETYPES.map((entry) => entry.id);

// Picks one INTRO archetype for the given seed. When recentArchetypes is
// provided, the most recent one is excluded so consecutive songs do not open the
// same way (mirrors pickEmotionalMode's shift-by-one avoidance).
export function resolveIntroVariant(seed: string, recentArchetypes: readonly string[] = []): IntroVariant {
  const count = INTRO_ARCHETYPES.length;
  const start = Math.floor(hashRatio(seed) * count) % count;
  const latest = recentArchetypes.at(-1);
  const index = count > 1 && INTRO_ARCHETYPES[start].id === latest ? (start + 1) % count : start;
  return INTRO_ARCHETYPES[index].build(seed);
}

// Rebuilds the full IntroVariant for a known archetype id and seed. Used by
// downstream stages to reconstruct the director's intro (bars / lineFloor /
// lineTarget) from the persisted plan, which stores only the archetype id plus
// the prompt-visible modifier and lyricInstruction. Passing the same seed the
// director used (`intro:${plan.seed}`) reproduces the identical variant.
export function buildIntroVariantById(id: string, seed: string): IntroVariant | undefined {
  return INTRO_ARCHETYPES.find((entry) => entry.id === id)?.build(seed);
}

export function critiqueLensLines(artistMd: string): string[] {
  const lens = bulletSection(artistMd, "### Critique Lens");
  return [
    "Critique lens:",
    ...(lens.length > 0
      ? lens
      : ["Start from the actual news/X material and follow the systems, incentives, and culture that shape it. Keep the critique concrete, sharp, and artist-specific."]),
    "The diss target is systems, incentives, styles, cultures, industries, and public structures. Do not attack private individuals or protected traits.",
    "Make the critique sharper than neutral observation: laugh at the structure, then stab it with concrete images, internal rhyme, and one clean punchline turn."
  ];
}
