// Plan v10.8: motif-based observation scorer.
// Replaces the surface-word soup that filterObservationEntries used to apply.
// Each tweet is scored against the persona motif buckets so the artist actually
// engages with content that matches their geographies, themes, vocabulary, and
// sonic universe.

import type { PersonaMotifBundle } from "./personaMotifExtractor.js";

export interface MotifMatchSummary {
  bucket: "themes" | "vocabulary" | "geographies" | "sound";
  values: string[];
}

export interface MinimalObservation {
  text: string;
  author?: string;
}

export interface ScoredObservation<T extends MinimalObservation = MinimalObservation> {
  entry: T;
  score: number;
  matched: MotifMatchSummary[];
  avoidHits: string[];
}

const weights = {
  themes: 3,
  vocabulary: 2,
  geographies: 4,
  sound: 1,
  avoid: 5
} as const;

function findMatches(haystackLower: string, needles: string[]): string[] {
  if (needles.length === 0) return [];
  return needles.filter((needle) => {
    const lower = needle.toLowerCase();
    return lower.length > 0 && haystackLower.includes(lower);
  });
}

export function scoreObservation<T extends MinimalObservation>(
  entry: T,
  motifs: PersonaMotifBundle
): ScoredObservation<T> {
  const haystack = `${entry.text} ${entry.author ?? ""}`.toLowerCase();
  const themeHits = findMatches(haystack, motifs.themes);
  const vocabHits = findMatches(haystack, motifs.vocabulary);
  const geoHits = findMatches(haystack, motifs.geographies);
  const soundHits = findMatches(haystack, motifs.sound);
  const avoidHits = findMatches(haystack, motifs.avoid);

  const score =
    themeHits.length * weights.themes +
    vocabHits.length * weights.vocabulary +
    geoHits.length * weights.geographies +
    soundHits.length * weights.sound -
    avoidHits.length * weights.avoid;

  const matched: MotifMatchSummary[] = [];
  if (themeHits.length > 0) matched.push({ bucket: "themes", values: themeHits });
  if (vocabHits.length > 0) matched.push({ bucket: "vocabulary", values: vocabHits });
  if (geoHits.length > 0) matched.push({ bucket: "geographies", values: geoHits });
  if (soundHits.length > 0) matched.push({ bucket: "sound", values: soundHits });

  return { entry, score, matched, avoidHits };
}

export interface RankObservationsOptions {
  limit?: number;
  fallbackLimit?: number;
}

export function rankObservations<T extends MinimalObservation>(
  entries: T[],
  motifs: PersonaMotifBundle,
  options: RankObservationsOptions = {}
): ScoredObservation<T>[] {
  const limit = options.limit ?? 12;
  const fallbackLimit = options.fallbackLimit ?? 12;
  const motifBucketCount =
    motifs.themes.length +
    motifs.vocabulary.length +
    motifs.geographies.length +
    motifs.sound.length;
  if (motifBucketCount === 0) {
    return entries.slice(0, fallbackLimit).map((entry) => ({
      entry,
      score: 0,
      matched: [],
      avoidHits: []
    }));
  }
  const scored = entries.map((entry) => scoreObservation(entry, motifs));
  const aligned = scored.filter((item) => item.score > 0 && item.matched.length > 0);
  if (aligned.length === 0) {
    return scored.slice(0, fallbackLimit);
  }
  return aligned
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.matched.length - a.matched.length;
    })
    .slice(0, limit);
}

export function summarizeMatches(scored: ScoredObservation): string {
  if (scored.matched.length === 0) {
    return scored.avoidHits.length > 0 ? `avoid: ${scored.avoidHits.join("/")}` : "no motif match";
  }
  return scored.matched
    .map((bucket) => `${bucket.bucket}: ${bucket.values.slice(0, 3).join("/")}`)
    .join(" | ");
}
