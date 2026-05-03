import type { AiReviewProvider } from "../types.js";
import { callAiProvider } from "./aiProviderClient.js";
import { secretLikePattern } from "./personaMigrator.js";
import { extractPersonaMotifs, summarizeMotifs, topQueryKeywords, type PersonaMotifBundle } from "./personaMotifExtractor.js";

export interface XQueryStrategyInput {
  personaText?: string;
  observationHistory?: string;
  manualSeed?: { hint?: string };
  aiReviewProvider?: AiReviewProvider;
  motifs?: PersonaMotifBundle;
}

export interface XQueryStrategy {
  mode: "topical" | "evergreen";
  query: string;
  recencyWindow?: number;
  motifKeywords?: string[];
}

function sanitizeQuery(value: string): string {
  return value.replace(/[^\p{L}\p{N}\s#_-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function motifDrivenQuery(motifs: PersonaMotifBundle): { query: string; keywords: string[] } | undefined {
  const keywords = topQueryKeywords(motifs, 5);
  if (keywords.length === 0) return undefined;
  return {
    query: sanitizeQuery(keywords.join(" OR ")),
    keywords
  };
}

function fromHint(hint: string): XQueryStrategy | undefined {
  if (/最新|ニュース|いま|今|today|news|current/i.test(hint)) {
    return { mode: "topical", query: sanitizeQuery(hint), recencyWindow: 24 };
  }
  if (/普遍|永遠|evergreen|timeless/i.test(hint)) {
    return { mode: "evergreen", query: sanitizeQuery(hint) };
  }
  return undefined;
}

function parseResponse(raw: string, fallbackQuery: string): XQueryStrategy {
  const mode = /evergreen/i.test(raw) ? "evergreen" : "topical";
  const query = sanitizeQuery(raw.match(/query\s*:\s*(.+)/i)?.[1] ?? fallbackQuery) || fallbackQuery;
  const hours = Number.parseInt(raw.match(/recency(?:Window)?\s*:\s*(\d+)/i)?.[1] ?? "", 10);
  return {
    mode,
    query,
    ...(mode === "topical" ? { recencyWindow: Number.isFinite(hours) ? hours : 24 } : {})
  };
}

export async function planQueryStrategy(input: XQueryStrategyInput = {}): Promise<XQueryStrategy> {
  const combined = `${input.observationHistory ?? ""}\n${input.manualSeed?.hint ?? ""}`;
  if (secretLikePattern.test(combined)) {
    throw new Error("x_query_strategy_contains_secret_like_text");
  }
  const motifs = input.motifs ?? extractPersonaMotifs(input.personaText);
  const motifQuery = motifDrivenQuery(motifs);
  const hint = input.manualSeed?.hint?.trim() ?? "";
  const hinted = hint ? fromHint(hint) : undefined;
  if (hinted) {
    return motifQuery ? { ...hinted, motifKeywords: motifQuery.keywords } : hinted;
  }
  const fallbackQuery = sanitizeQuery(motifQuery?.query || hint || input.personaText || "music society culture") || "music society culture";
  const provider = input.aiReviewProvider ?? "mock";
  if (provider === "mock") {
    return {
      mode: "topical",
      query: fallbackQuery,
      recencyWindow: 24,
      ...(motifQuery ? { motifKeywords: motifQuery.keywords } : {})
    };
  }
  const motifLine = summarizeMotifs(motifs);
  const raw = await callAiProvider([
    "System: Choose a safe X/Twitter observation query strategy for an autonomous musical artist.",
    "Return mode: topical|evergreen, query: <short query>, recency: <hours for topical>.",
    "The query must reflect the artist's persona motifs below — pick keywords that the artist would actually engage with.",
    "Avoid high-frequency polling and avoid secrets.",
    `Producer hint: ${hint || "(none)"}`,
    `Persona motifs: ${motifLine || "(none)"}`,
    `Motif keywords: ${(motifQuery?.keywords ?? []).join(", ") || "(none)"}`,
    `Persona excerpt: ${(input.personaText ?? "").slice(0, 800)}`,
    `Recent observations: ${(input.observationHistory ?? "").slice(0, 1600)}`
  ].join("\n"), { provider });
  if (secretLikePattern.test(raw)) {
    throw new Error("x_query_strategy_response_contains_secret_like_text");
  }
  const parsed = parseResponse(raw, fallbackQuery);
  return motifQuery ? { ...parsed, motifKeywords: motifQuery.keywords } : parsed;
}
