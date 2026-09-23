import type { AiReviewProvider } from "../types.js";
import { callAiProvider, isAiProviderMockFallbackResponse } from "../services/aiProviderClient.js";
import { buildExcludeSynthesisPrompt } from "./excludeSynthesisPrompt.js";

export interface BuildExcludeInput {
  artistAvoid?: string[];
  genre?: string;
  voices?: string[];
  copyrightSourceNameDenylist?: string[];
  /** Fast bands carry the tempo-preserving exclusions from the style catalog. */
  fastTempo?: boolean;
}

// Producer ruling 2026-09-17: brass had crept into the arrangement, and the slow
// descriptors below are the ones the style catalog names as the reason a fast
// recipe comes back mellow. These lead the list so the 8-item cap keeps them.
// Measured over 123 judged songs: clipped horn stabs at section turns travel with
// the songs the producer kept (94.7% of fast kept songs mention horns), while a
// sustained horn pad or a solo sax lead is what makes the arrangement feel bloated.
// Exclude the lead/pad use, not the punctuation.
const HORN_REDUCTION_EXCLUDES = ["solo sax lead", "horn section pad"] as const;
// Producer ruling 2026-09-17: a fast song drifted into jazz-fusion once the bass
// stepped forward. The genre line is display: a singing bass, a virtuoso fill and a
// polished mix read as fusion even when every other tag is hip-hop.
// Slap is welcome as a momentary accent — several kept songs say "occasional slap
// attacks". What runs six times more often in rejected songs is slap carrying the
// groove, next to sustained electric piano and a polished mix: the fusion drift.
const FAST_TEMPO_EXCLUDES = [
  "slap bass groove",
  "smooth jazz fusion",
  "glossy pop sheen",
  "soft ballad"
] as const;

export interface BuildExcludeResult {
  items: string[];
  text: string;
}

export interface ExcludeAiSynthesisOptions {
  provider?: AiReviewProvider;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function containsSourceName(value: string, denylist: string[]): boolean {
  const lower = value.toLowerCase();
  return denylist.some((name) => {
    const normalized = normalize(name).toLowerCase();
    return normalized.length >= 3 && lower.includes(normalized);
  });
}

// Genre-specific clashing styles drawn from yaml_template.md L172 examples and
// style_catalog.md exclusions. Suno V5.5 prefers concrete sonic conflicts over
// generic "no X" phrasing.
const genreClashMap: Record<string, readonly string[]> = {
  rap: ["opera vibrato", "festival EDM drop"],
  hip: ["opera vibrato"],
  jazz: ["festival EDM drop", "EDM supersaws"],
  edm: ["acoustic campfire strum"],
  rock: ["female humming"],
  punk: ["female humming"]
};

function genreClashFor(genre: string): string[] {
  const lower = genre.toLowerCase();
  const matches = new Set<string>();
  for (const [key, values] of Object.entries(genreClashMap)) {
    if (lower.includes(key)) {
      for (const value of values) matches.add(value);
    }
  }
  return [...matches];
}

export function buildExclude(input: BuildExcludeInput = {}): BuildExcludeResult {
  const denylist = input.copyrightSourceNameDenylist ?? [];
  const genre = (input.genre ?? "").toLowerCase();
  const base = [
    ...(input.artistAvoid ?? []),
    ...HORN_REDUCTION_EXCLUDES,
    ...(input.fastTempo ? FAST_TEMPO_EXCLUDES : []),
    ...genreClashFor(genre),
    (input.voices ?? []).length > 0 ? "celebrity voice imitation" : "source-name imitation",
    "muddy master",
    "autotune",
    "generic reverb",
    "vocal doubling",
    "glossy mastering",
    "fake crowd noise",
    "arena rock reverb",
    "over-compressed master"
  ].filter((item): item is string => Boolean(item));
  const items = [...new Set(base.map(normalize))]
    .filter((item) => !containsSourceName(item, denylist))
    .slice(0, 8);
  const safeItems = items.length >= 2 ? items : [...items, "copyrighted artist cloning", "generic stock loop"].slice(0, 8);
  return {
    items: safeItems,
    text: safeItems.join(", ").slice(0, 240)
  };
}

function normalizeAiExclude(raw: string, denylist: string[]): BuildExcludeResult | undefined {
  const text = raw
    .replace(/```(?:text)?/gi, "")
    .replace(/```/g, "")
    .replace(/^#\s*Exclude Styles\s*/im, "")
    .trim();
  if (!text || isAiProviderMockFallbackResponse(text)) {
    return undefined;
  }
  const items = [...new Set(text.split(",").map(normalize))]
    .filter((item) => item && !/^no\s+/i.test(item))
    .filter((item) => !containsSourceName(item, denylist))
    .slice(0, 8);
  if (items.length < 2) {
    return undefined;
  }
  return { items, text: items.join(", ").slice(0, 240) };
}

export async function synthesizeExclude(input: BuildExcludeInput = {}, options: ExcludeAiSynthesisOptions = {}): Promise<BuildExcludeResult> {
  if (!options.provider || options.provider === "mock") {
    return buildExclude(input);
  }
  const prompt = buildExcludeSynthesisPrompt(input);
  const raw = await callAiProvider([prompt.system, "", prompt.user].join("\n"), { provider: options.provider });
  return normalizeAiExclude(raw, input.copyrightSourceNameDenylist ?? []) ?? buildExclude(input);
}
