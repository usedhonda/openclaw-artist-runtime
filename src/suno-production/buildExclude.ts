import type { AiReviewProvider } from "../types.js";
import { callAiProvider, isAiProviderMockFallbackResponse } from "../services/aiProviderClient.js";
import { buildExcludeSynthesisPrompt } from "./excludeSynthesisPrompt.js";

export interface BuildExcludeInput {
  artistAvoid?: string[];
  genre?: string;
  voices?: string[];
  copyrightSourceNameDenylist?: string[];
}

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
    ...genreClashFor(genre),
    (input.voices ?? []).length > 0 ? "celebrity voice imitation" : "source-name imitation",
    "muddy master"
  ].filter((item): item is string => Boolean(item));
  const items = [...new Set(base.map(normalize))]
    .filter((item) => !containsSourceName(item, denylist))
    .slice(0, 5);
  const safeItems = items.length >= 2 ? items : [...items, "copyrighted artist cloning", "generic stock loop"].slice(0, 5);
  return {
    items: safeItems,
    text: safeItems.join(", ").slice(0, 200)
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
    .slice(0, 5);
  if (items.length < 2) {
    return undefined;
  }
  return { items, text: items.join(", ").slice(0, 200) };
}

export async function synthesizeExclude(input: BuildExcludeInput = {}, options: ExcludeAiSynthesisOptions = {}): Promise<BuildExcludeResult> {
  if (!options.provider || options.provider === "mock") {
    return buildExclude(input);
  }
  const prompt = buildExcludeSynthesisPrompt(input);
  const raw = await callAiProvider([prompt.system, "", prompt.user].join("\n"), { provider: options.provider });
  return normalizeAiExclude(raw, input.copyrightSourceNameDenylist ?? []) ?? buildExclude(input);
}
