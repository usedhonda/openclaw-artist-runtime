import { createHash } from "node:crypto";

export const AGGRESSIVE_ARTIST_MOOD = "aggressive urban critique, biting sarcasm, late-night pressure, anti-gloss civic anger";
export const DOPAGAKI_TARGET_RATE = 0.4;

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
  return `${prefix}, ドパガキ強め, overt high stimulus, clipped instant hook burst`;
}

export function dopagakiPromptLines(decision?: DopagakiVariationDecision): string[] {
  if (!decision?.active) {
    return [
      "Dopagaki variation: inactive for this song.",
      "Keep the default spacious rap pacing; do not force clipped high-stimulus structure."
    ];
  }
  return [
    "Dopagaki variation: ACTIVE / OVERT for this song.",
    "Use clipped fragments, instant hook pressure, bilingual chant accents, and fast-development contrast inside the existing artist style.",
    "Limit high-speed or double-density delivery to 2-4 bar bursts. Never turn the full song into double-time.",
    "Keep the nu-jazz low-bass core and dry intelligible vocal identity intact."
  ];
}

export function shibuyaAngerLensLines(): string[] {
  return [
    "Shibuya anger lens:",
    "Start from the actual news/X material, then fold it back into the artist's anger at present-day Shibuya: redevelopment failure, youth pushed out, culture flattened into safe commerce, convenience used to hide civic damage.",
    "The diss target is the urban system, incentives, signage, brands, safety theater, and redevelopment logic. Do not attack private individuals or protected traits.",
    "Make the critique sharper than neutral observation: laugh at the structure, then stab it with concrete images, internal rhyme, and one clean punchline turn."
  ];
}
