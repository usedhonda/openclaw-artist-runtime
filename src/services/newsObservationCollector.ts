// Plan v10.38 Phase B: news observation collector.
//
// Pulls RSS feeds opt-in via OPENCLAW_NEWS_RSS_URLS, parses item / entry tags
// for RSS 2.0 and Atom, scores entries against the same persona motif bundle
// the X collector uses, and writes a daily cache under
// `<workspace>/observations/news-YYYY-MM-DD.md`. The cache schema mirrors
// the X observation cache so songSpawnProposer can merge both streams when
// picking today's primary motivation. Default is no-op (no env, no feeds).

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { secretLikePattern } from "./personaMigrator.js";
import { getNewsRssUrls } from "./runtimeConfig.js";
import {
  extractPersonaMotifs,
  type PersonaMotifBundle
} from "./personaMotifExtractor.js";
import { rankObservations, summarizeMatches } from "./xObservationScorer.js";

export interface NewsObservationEntry {
  text: string;
  author?: string;
  url?: string;
  postedAt?: string;
  source?: string;
  motifMatch?: string;
  motifScore?: number;
}

export interface NewsObservationContext {
  personaText?: string;
  now?: Date;
  fetcher?: (url: string) => Promise<string>;
}

export interface NewsObservationResult {
  status: "collected" | "cached" | "skipped";
  path: string;
  entries: NewsObservationEntry[];
  reason?: string;
}

const newsCacheTtlMs = 6 * 60 * 60 * 1000;
const maxFeedsPerRun = 5;
const maxItemsPerFeed = 20;
const maxEntries = 60;

function jstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function newsCachePath(root: string, now = new Date()): string {
  return join(root, "observations", `news-${jstDate(now)}.md`);
}

function rssUrlsFromEnv(): string[] {
  return getNewsRssUrls().slice(0, maxFeedsPerRun);
}

async function defaultFetcher(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "openclaw-artist-runtime/0.3 (+rss-news-observation)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml"
      }
    });
    if (!response.ok) {
      throw new Error(`rss_fetch_failed_${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTagText(item: string, tag: string): string | undefined {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = item.match(pattern);
  if (!match) return undefined;
  const raw = match[1] ?? "";
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const inner = cdata ? cdata[1] : raw;
  return decodeXmlEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractLink(item: string): string | undefined {
  const hrefMatch = item.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  if (hrefMatch?.[1]) return hrefMatch[1].trim();
  const inline = item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  if (!inline?.[1]) return undefined;
  const value = decodeXmlEntities(inline[1].replace(/<[^>]+>/g, " ").trim());
  return value || undefined;
}

function extractPubDate(item: string): string | undefined {
  return (
    extractTagText(item, "pubDate") ??
    extractTagText(item, "published") ??
    extractTagText(item, "updated")
  );
}

function parseRssXml(xml: string, source: string): NewsObservationEntry[] {
  const items: string[] = [];
  const itemRegex = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItemsPerFeed) {
    items.push(match[0]);
  }
  const entries: NewsObservationEntry[] = [];
  for (const item of items) {
    const title = extractTagText(item, "title");
    if (!title) continue;
    const description =
      extractTagText(item, "description") ??
      extractTagText(item, "summary") ??
      extractTagText(item, "content");
    const text = [title, description].filter(Boolean).join(" — ").slice(0, 320);
    if (!text) continue;
    if (secretLikePattern.test(text)) continue;
    entries.push({
      text,
      url: extractLink(item),
      postedAt: extractPubDate(item),
      source
    });
  }
  return entries;
}

function renderNewsObservation(entries: NewsObservationEntry[], now: Date): string {
  const lines = [`# News Observations ${jstDate(now)}`, ""];
  for (const entry of entries) {
    lines.push(`- text: ${JSON.stringify(entry.text)}`);
    if (entry.source) lines.push(`  source: ${JSON.stringify(entry.source)}`);
    if (entry.url) lines.push(`  url: ${JSON.stringify(entry.url)}`);
    if (entry.postedAt) lines.push(`  postedAt: ${JSON.stringify(entry.postedAt)}`);
    if (entry.motifMatch) lines.push(`  motifMatch: ${JSON.stringify(entry.motifMatch)}`);
    if (typeof entry.motifScore === "number" && entry.motifScore !== 0) {
      lines.push(`  motifScore: ${entry.motifScore}`);
    }
  }
  return lines.join("\n");
}

function parseQuoted(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "null") return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed.replace(/^'|'$/g, '"'));
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseNewsObservationFile(content: string): NewsObservationEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: NewsObservationEntry[] = [];
  let current: Partial<NewsObservationEntry> | undefined;
  for (const raw of lines) {
    const textMatch = raw.match(/^-\s+text:\s+(.*)$/);
    if (textMatch) {
      if (current?.text) entries.push(current as NewsObservationEntry);
      current = { text: parseQuoted(textMatch[1]) };
      continue;
    }
    if (!current) continue;
    const urlMatch = raw.match(/^\s+url:\s+(.*)$/);
    if (urlMatch) current.url = parseQuoted(urlMatch[1]) || undefined;
    const dateMatch = raw.match(/^\s+postedAt:\s+(.*)$/);
    if (dateMatch) current.postedAt = parseQuoted(dateMatch[1]) || undefined;
    const sourceMatch = raw.match(/^\s+source:\s+(.*)$/);
    if (sourceMatch) current.source = parseQuoted(sourceMatch[1]) || undefined;
    const motifMatch = raw.match(/^\s+motifMatch:\s+(.*)$/);
    if (motifMatch) current.motifMatch = parseQuoted(motifMatch[1]) || undefined;
    const motifScoreMatch = raw.match(/^\s+motifScore:\s+(-?\d+)$/);
    if (motifScoreMatch) {
      const parsed = Number.parseInt(motifScoreMatch[1], 10);
      current.motifScore = Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  if (current?.text) entries.push(current as NewsObservationEntry);
  return entries;
}

export async function readTodayNewsObservations(
  root: string,
  now = new Date()
): Promise<NewsObservationEntry[]> {
  const content = await readFile(newsCachePath(root, now), "utf8").catch(() => "");
  return content ? parseNewsObservationFile(content) : [];
}

function feedSourceLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 32);
  }
}

function rankAndAnnotate(
  entries: NewsObservationEntry[],
  motifs: PersonaMotifBundle
): NewsObservationEntry[] {
  const scored = rankObservations(entries, motifs);
  return scored.slice(0, maxEntries).map((row) => ({
    ...row.entry,
    motifMatch: row.matched.length > 0 ? summarizeMatches(row) : undefined,
    motifScore: row.score
  }));
}

export async function collectNewsObservations(
  root: string,
  context: NewsObservationContext = {}
): Promise<NewsObservationResult> {
  const now = context.now ?? new Date();
  const urls = rssUrlsFromEnv();
  const path = newsCachePath(root, now);
  if (urls.length === 0) {
    return { status: "skipped", path, entries: [], reason: "OPENCLAW_NEWS_RSS_URLS unset" };
  }
  const cached = await readFile(path, "utf8").catch(() => "");
  if (cached) {
    const cachedStat = await stat(path).catch(() => undefined);
    if (cachedStat && now.getTime() - cachedStat.mtime.getTime() < newsCacheTtlMs) {
      return {
        status: "cached",
        path,
        entries: parseNewsObservationFile(cached)
      };
    }
  }
  const motifs = extractPersonaMotifs(context.personaText);
  const fetcher = context.fetcher ?? defaultFetcher;
  const collected: NewsObservationEntry[] = [];
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const xml = await fetcher(url);
      collected.push(...parseRssXml(xml, feedSourceLabel(url)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${feedSourceLabel(url)}:${message}`);
    }
  }
  if (collected.length === 0) {
    return {
      status: "skipped",
      path,
      entries: [],
      reason: failures.length > 0 ? `all_rss_failed:${failures.join(",")}` : "rss_returned_no_items"
    };
  }
  if (secretLikePattern.test(collected.map((entry) => entry.text).join("\n"))) {
    throw new Error("news_observation_contains_secret_like_text");
  }
  const annotated = rankAndAnnotate(collected, motifs);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${renderNewsObservation(annotated, now).trim()}\n`, "utf8");
  return { status: "collected", path, entries: annotated };
}
