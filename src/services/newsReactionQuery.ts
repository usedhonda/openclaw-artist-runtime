import type { NewsObservationEntry } from "./newsObservationCollector.js";
import { extractPersonaMotifs } from "./personaMotifExtractor.js";
import { decomposeToQueryTokens, type XObservationContext } from "./xObservationCollector.js";

export interface NewsReactionQueryPlan {
  queries: string[];
  seed?: XObservationContext["reactionSeed"];
}

interface NewsReactionQueryOptions {
  personaText?: string;
}

// News aggregators append the outlet name to the headline; it is never search
// material. Cut it whether it follows a separator or (after upstream space
// cleaning) trails as bare text such as "… ダイヤモンド オン".
const newsSourceSeparatorPattern = /[|｜/／].*$/;
const newsSourceTailPattern =
  /(?:ダイヤモンド|東洋経済|現代ビジネス|プレジデント|朝日新聞|読売新聞|毎日新聞|日本経済新聞|日経|産経新聞|共同通信|時事通信|ロイター|ブルームバーグ|PR\s?TIMES|ITmedia|NHK|フォーブス|Forbes|オリコン|ハフポスト|ねとらぼ|マイナビ)[\s\S]*$/i;

// Counter phrases (58社, 8割超) read as noise in a tweet search.
const numericCounterPattern = /[0-9０-９]+(?:社|割超?|%|％|人|円|年|万|億|件|位|台|個|名|軒)?/g;

// Common headline framing that nobody repeats verbatim in a tweet.
const leadHookPattern = /^[^、。！!？?]{0,10}?まさか[^、。！!？?]*?[！!]\s*/;
const tailFramingPattern = /(?:のワケ|ワケ|とは|なのか)\s*$/;

const ignoredTokens = /^(?:https?|www|com|news|google|rss|オン)$/i;

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

// Strip URLs, the outlet-name suffix, numeric counters and headline framing so
// what reaches decomposeToQueryTokens is content words, not boilerplate.
function normalizeHeadline(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(newsSourceSeparatorPattern, " ")
    .replace(newsSourceTailPattern, " ")
    .replace(/[…]+|\.{2,}/g, " ")
    .replace(leadHookPattern, " ")
    .replace(numericCounterPattern, " ")
    .replace(tailFramingPattern, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A geography token (渋谷) buried inside a proper noun (西武渋谷店) is dropped by
// decomposeToQueryTokens' >4-char coinage rule. Space-padding the persona geo
// terms rescues the geo-anchored pair (西武 渋谷) without re-tokenizing.
function padGeographies(text: string, geographies: string[]): string {
  let padded = text;
  for (const geo of geographies) {
    if (geo.length >= 2 && padded.includes(geo)) {
      padded = padded.split(geo).join(` ${geo} `);
    }
  }
  return padded.replace(/\s+/g, " ").trim();
}

function usableTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token.length > 0 && !ignoredTokens.test(token));
}

export function buildNewsReactionQueries(
  entries: NewsObservationEntry[],
  options: NewsReactionQueryOptions = {}
): NewsReactionQueryPlan {
  const top = entries.find((entry) => entry.url || entry.text.trim().length > 0);
  if (!top) return { queries: [] };

  const geographies = extractPersonaMotifs(options.personaText).geographies;
  const geoSet = new Set(geographies.map((geo) => geo.toLowerCase()));
  const normalized = normalizeHeadline(top.text);

  // Rung a: the most specific pair. Geo-padding surfaces the geo-anchored proper
  // noun (西武 渋谷) that would otherwise be dropped as a >4-char coinage.
  const pairTokens = usableTokens(decomposeToQueryTokens(padGeographies(normalized, geographies)));
  const pair = pairTokens.slice(0, 2).join(" ");

  // Rung c: broader fallback = strongest single topic token + a geo term. The
  // topic token comes from the un-padded headline so it is a topic word (閉店),
  // not the proper noun rung a already covers.
  const topicTokens = usableTokens(decomposeToQueryTokens(normalized));
  const topicToken = topicTokens.find((token) => !geoSet.has(token.toLowerCase())) ?? topicTokens[0];
  const geoToken = geographies.find((geo) => normalized.includes(geo));
  const broadFallback = topicToken
    ? geoToken && geoToken.toLowerCase() !== topicToken.toLowerCase()
      ? `${topicToken} ${geoToken}`
      : topicToken
    : undefined;

  const queries = unique(
    [
      pair || undefined,
      pair ? `${pair} lang:ja` : undefined,
      broadFallback
    ].filter((query): query is string => Boolean(query))
  );

  if (queries.length === 0) return { queries: [] };
  return {
    queries,
    seed: {
      title: top.text.slice(0, 140),
      url: top.url,
      source: top.source
    }
  };
}
