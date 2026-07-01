import type { NewsObservationEntry } from "./newsObservationCollector.js";
import { extractPersonaMotifs, topQueryKeywords } from "./personaMotifExtractor.js";
import type { XObservationContext } from "./xObservationCollector.js";

export interface NewsReactionQueryPlan {
  queries: string[];
  seed?: XObservationContext["reactionSeed"];
}

interface NewsReactionQueryOptions {
  now?: Date;
  personaText?: string;
}

const ignoredTokens = /^(?:https?|www|com|news|google|rss)$/i;

function cleanNewsSearchToken(value: string): string {
  return value
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{Letter}\p{Number}一-龠ぁ-んァ-ヶー]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function quotePhrase(value: string): string {
  return `"${value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

function sinceDate(now: Date): string {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function splitTokens(text: string): string[] {
  return cleanNewsSearchToken(text)
    .split(/\s+/)
    .filter((token) => Array.from(token).length >= 2)
    .filter((token) => !ignoredTokens.test(token));
}

function headlinePhrases(text: string): string[] {
  const noUrls = text.replace(/https?:\/\/\S+/g, " ");
  const firstClause = noUrls
    .split(/[。!?！？\n]| - |｜|\|/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => Array.from(part).length >= 4);
  const compact = cleanNewsSearchToken(firstClause ?? noUrls);
  const tokens = splitTokens(text);
  const adjacentPairs = tokens.slice(0, 4).flatMap((token, index) => {
    const next = tokens[index + 1];
    return next ? [`${token} ${next}`] : [];
  });
  return unique([
    compact.slice(0, 48),
    ...adjacentPairs,
    ...tokens.filter((token) => /[A-Z0-9]{2,}/.test(token) || /[一-龠ぁ-んァ-ヶー]{3,}/.test(token)).slice(0, 4)
  ]).filter((phrase) => Array.from(phrase).length >= 2);
}

function motifQueryVariant(personaText: string | undefined, basePhrase: string | undefined): string | undefined {
  if (!personaText || !basePhrase) return undefined;
  const motifs = topQueryKeywords(extractPersonaMotifs(personaText), 3);
  if (motifs.length === 0) return undefined;
  return `${quotePhrase(basePhrase)} (${motifs.map(quotePhrase).join(" OR ")})`;
}

export function buildNewsReactionQueries(
  entries: NewsObservationEntry[],
  options: NewsReactionQueryOptions = {}
): NewsReactionQueryPlan {
  const top = entries.find((entry) => entry.url || entry.text.trim().length > 0);
  if (!top) return { queries: [] };
  const tokens = splitTokens(top.text).slice(0, 6);
  const phrases = headlinePhrases(top.text);
  if (tokens.length === 0 && phrases.length === 0) return { queries: [] };
  const now = options.now ?? new Date();
  const exactPhrase = phrases[0] ?? tokens[0];
  const entityPhrase = phrases.find((phrase) => phrase !== exactPhrase) ?? tokens.slice(0, 2).join(" ");
  const broadFallback = tokens.length > 0 ? tokens.join(" OR ") : undefined;
  const datedNewsQuery = exactPhrase ? `${quotePhrase(exactPhrase)} lang:ja since:${sinceDate(now)}` : undefined;
  return {
    queries: unique([
      exactPhrase ? quotePhrase(exactPhrase) : undefined,
      entityPhrase ? quotePhrase(entityPhrase) : undefined,
      datedNewsQuery,
      motifQueryVariant(options.personaText, exactPhrase),
      broadFallback
    ].filter((query): query is string => Boolean(query))),
    seed: {
      title: top.text.slice(0, 140),
      url: top.url,
      source: top.source
    }
  };
}
