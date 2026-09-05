import type { AiReviewProvider } from "../types.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { callAiProvider, isAiNotConfiguredResponse, isAiProviderMockFallbackResponse } from "./aiProviderClient.js";
import { listSongStates } from "./artistState.js";

export interface EditorialNewsCandidate {
  text: string;
  source?: string;
  url?: string;
  lookupUrl?: string;
  postedAt?: string;
}

export interface NewsEditorialSelectionResult<T extends EditorialNewsCandidate> {
  entries: T[];
  reason?: string;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function parseIndices(raw: string, size: number): number[] | undefined {
  const json = raw.match(/\[[\s\S]*?\]/)?.[0];
  if (!json) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    const indices = parsed.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < size);
    if (indices.length !== parsed.length) return undefined;
    const unique = [...new Set(indices)];
    return unique.slice(0, 5);
  } catch {
    return undefined;
  }
}

async function recentSongContext(root: string): Promise<string> {
  const songs = await listSongStates(root).catch(() => []);
  const briefs = await Promise.all(songs.slice(0, 8).map(async (song) => {
    const path = song.briefPath ?? join(root, "songs", song.songId, "brief.md");
    const text = await readFile(path, "utf8").catch(() => "");
    return `- ${song.title} [${song.songId}] source: songs/${song.songId}/brief.md\n  ${clip(text.replace(/\s+/g, " ").trim(), 300)}`;
  }));
  return briefs.filter((brief) => !brief.endsWith("  ")).join("\n");
}

function buildPrompt<T extends EditorialNewsCandidate>(
  candidates: T[],
  personaText: string,
  songs: string
): string {
  const list = candidates.map((candidate, index) => [
    `[${index}] headline/excerpt: ${clip(candidate.text, 360)}`,
    `source: ${candidate.source ?? "unknown"}`,
    `rss lookup URL: ${candidate.lookupUrl ?? "none"}`,
    `publisher URL: ${candidate.url ?? "none"}`
  ].join("\n")).join("\n\n");
  return [
    "Choose 3-5 genuinely distinct news candidates for an autonomous public musician.",
    "Return JSON only: an array of zero-based candidate indices, for example [2, 7, 11].",
    "Use only the indexed candidates; never invent or rewrite news data.",
    "Prefer grounded human or cultural stakes and varied topics. Exclude stock quotes, bare corporate PR, geography-only or person-name matches, and repeats of recent topics unless there is a clear new development.",
    "The text supplied is only a headline/excerpt unless explicitly marked otherwise; do not infer article-body facts.",
    `Artist persona:\n${clip(personaText || "(not supplied)", 1800)}`,
    `Recent song briefs (avoid repeating their themes; source references are local paths only):\n${songs || "(none)"}`,
    `Candidates:\n${list}`
  ].join("\n\n");
}

function editorialPool<T extends EditorialNewsCandidate>(candidates: T[]): T[] {
  const seen = new Set<string>();
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    const key = [candidate.url, candidate.lookupUrl, candidate.text.replace(/\s+/g, " ").trim().toLowerCase()].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const source = candidate.source ?? "unknown";
    const group = groups.get(source) ?? [];
    group.push(candidate);
    groups.set(source, group);
  }
  const pool: T[] = [];
  while (pool.length < 60) {
    let added = false;
    for (const group of groups.values()) {
      const candidate = group.shift();
      if (!candidate) continue;
      pool.push(candidate);
      added = true;
      if (pool.length >= 60) break;
    }
    if (!added) break;
  }
  return pool;
}

export async function selectNewsEditorially<T extends EditorialNewsCandidate>(
  root: string,
  candidates: T[],
  options: { provider?: AiReviewProvider; personaText?: string } = {}
): Promise<NewsEditorialSelectionResult<T>> {
  const provider = options.provider;
  if (!provider || provider === "mock") return { entries: candidates };
  const pool = editorialPool(candidates);
  let raw: string;
  try {
    raw = await callAiProvider(buildPrompt(pool, options.personaText ?? "", await recentSongContext(root)), { provider });
  } catch {
    return { entries: [], reason: "news_editorial_selection_provider_failed" };
  }
  if (isAiNotConfiguredResponse(raw)) return { entries: [], reason: "news_editorial_selection_provider_not_configured" };
  if (isAiProviderMockFallbackResponse(raw)) return { entries: [], reason: "news_editorial_selection_provider_failed" };
  const indices = parseIndices(raw, pool.length);
  if (!indices) return { entries: [], reason: "news_editorial_selection_invalid_indices" };
  if (indices.length === 0) return { entries: [], reason: "news_editorial_selection_no_suitable_candidates" };
  return { entries: indices.map((index) => pool[index]).filter((entry): entry is T => Boolean(entry)) };
}
