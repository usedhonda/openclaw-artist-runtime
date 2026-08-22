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

function hashRatio(value: string): number {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return Number.parseInt(hash, 16) / 0xffffffff;
}

function bulletSection(artistMd: string, heading: string): string[] {
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
