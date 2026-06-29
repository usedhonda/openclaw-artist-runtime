// Plan v10.38 Phase B: news observation collector.
//
// Reads broad topical news first, then optional operator RSS feeds and persona
// motif search feeds. Persona motifs color/rank the artist take, but they are
// not the first search target. Parses item / entry tags
// for RSS 2.0 and Atom, scores entries against the same persona motif bundle
// the X collector uses, and writes a daily cache under
// `<workspace>/observations/news-YYYY-MM-DD.md`. The cache schema mirrors
// the X observation cache so songSpawnProposer can merge both streams when
// picking today's primary motivation.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "playwright";
import { secretLikePattern } from "./personaMigrator.js";
import { getNewsRssUrls, isNewsArticleResolverEnabled, isNewsBrowserResolverEnabled } from "./runtimeConfig.js";
import {
  extractPersonaMotifs,
  topQueryKeywords,
  type PersonaMotifBundle
} from "./personaMotifExtractor.js";
import { rankObservations, summarizeMatches } from "./xObservationScorer.js";

export interface NewsObservationEntry {
  text: string;
  author?: string;
  url?: string;
  lookupUrl?: string;
  postedAt?: string;
  source?: string;
  motifMatch?: string;
  motifScore?: number;
}

export interface NewsArticleResolveInput {
  title: string;
  text: string;
  source?: string;
  candidateUrl?: string;
}

export interface NewsArticleResolution {
  url?: string;
  title?: string;
  excerpt?: string;
  source?: string;
}

export type NewsArticleResolver = (input: NewsArticleResolveInput) => Promise<NewsArticleResolution | undefined>;

export interface NewsObservationContext {
  personaText?: string;
  now?: Date;
  fetcher?: (url: string) => Promise<string>;
  articleResolver?: NewsArticleResolver;
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
const maxArticleResolutionsPerRun = 8;
const articleBrowserTimeoutMs = 20_000;
const browserUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

function jstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function newsCachePath(root: string, now = new Date()): string {
  return join(root, "observations", `news-${jstDate(now)}.md`);
}

function rssUrlsFromEnv(): string[] {
  return getNewsRssUrls().slice(0, maxFeedsPerRun);
}

function googleNewsSearchRssUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

export function buildTopicalNewsRssUrls(): string[] {
  return ["https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja"];
}

export function buildMotifNewsSearchUrls(motifs: PersonaMotifBundle, limit = 5): string[] {
  const keywords = topQueryKeywords(motifs, limit);
  if (keywords.length === 0) return [];
  return [googleNewsSearchRssUrl(keywords.join(" OR "))];
}

function newsRssUrlsForRun(motifs: PersonaMotifBundle): string[] {
  const envUrls = rssUrlsFromEnv();
  const motifUrls = buildMotifNewsSearchUrls(motifs);
  const urls = motifUrls.length > 0 ? [...buildTopicalNewsRssUrls(), ...envUrls, ...motifUrls] : envUrls;
  return [...new Set(urls)].slice(0, maxFeedsPerRun);
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

async function defaultHtmlFetcher(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) openclaw-artist-runtime/0.3",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.8,en;q=0.6"
      }
    });
    if (!response.ok) {
      throw new Error(`html_fetch_failed_${response.status}`);
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

function stripHtml(value: string): string {
  return decodeXmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMetaContent(html: string, keys: string[]): string | undefined {
  const tags = html.matchAll(/<meta\b[^>]*>/gi);
  for (const tag of tags) {
    const attrs = attributesFromTag(tag[0]);
    const name = attrs.property ?? attrs.name;
    if (!name || !keys.includes(name) || !attrs.content) continue;
    return decodeXmlEntities(attrs.content).replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function firstLinkHref(html: string, rel: string): string | undefined {
  const tags = html.matchAll(/<link\b[^>]*>/gi);
  for (const tag of tags) {
    const attrs = attributesFromTag(tag[0]);
    if (!attrs.href || !attrs.rel?.split(/\s+/).includes(rel)) continue;
    return decodeXmlEntities(attrs.href).trim();
  }
  return undefined;
}

function attributesFromTag(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const matches = tag.matchAll(/\b([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(["'])([\s\S]*?)\2/g);
  for (const match of matches) {
    const key = match[1]?.toLowerCase();
    const value = match[3];
    if (key && value !== undefined) attrs[key] = value;
  }
  return attrs;
}

function resolveUrl(value: string | undefined, base?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

function titleFromHtml(html: string): string | undefined {
  const ogTitle = firstMetaContent(html, ["og:title", "twitter:title"]);
  if (ogTitle) return ogTitle;
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? stripHtml(match[1]) : undefined;
}

function excerptFromHtml(html: string): string | undefined {
  return firstMetaContent(html, ["description", "og:description", "twitter:description"]);
}

function parseArticlePage(html: string, baseUrl: string): NewsArticleResolution | undefined {
  const canonical = resolveUrl(firstLinkHref(html, "canonical"), baseUrl);
  const ogUrl = resolveUrl(firstMetaContent(html, ["og:url"]), baseUrl);
  const url = [canonical, ogUrl, baseUrl].find((candidate) => isUsableArticleUrl(candidate));
  if (!url) return undefined;
  return {
    url,
    title: titleFromHtml(html),
    excerpt: excerptFromHtml(html)
  };
}

function googleSearchUrl(input: NewsArticleResolveInput): string {
  const terms = [input.title, input.source].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(terms)}&hl=ja&num=5`;
}

function unwrapGoogleResultUrl(raw: string, baseUrl: string): string | undefined {
  const resolved = resolveUrl(decodeXmlEntities(raw), baseUrl);
  if (!resolved) return undefined;
  try {
    const parsed = new URL(resolved);
    if (parsed.hostname === "www.google.com" && parsed.pathname === "/url") {
      const q = parsed.searchParams.get("q") ?? parsed.searchParams.get("url");
      return q ? resolveUrl(q) : undefined;
    }
    return resolved;
  } catch {
    return undefined;
  }
}

function firstSearchResultUrl(html: string, baseUrl: string): string | undefined {
  const hrefs = html.matchAll(/\bhref=["']([^"']+)["']/gi);
  for (const match of hrefs) {
    const candidate = unwrapGoogleResultUrl(match[1] ?? "", baseUrl);
    if (!candidate || !isUsableArticleUrl(candidate)) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname.endsWith("google.com") || parsed.hostname === "webcache.googleusercontent.com") continue;
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function isLikelyBrowserChallenge(url: string, title: string, bodyText: string): boolean {
  const haystack = `${url}\n${title}\n${bodyText}`.toLowerCase();
  return /\/sorry\/|captcha|unusual traffic|are you a robot|verify you are human|access denied|bot detection/.test(haystack);
}

async function parseBrowserArticlePage(page: Page): Promise<NewsArticleResolution | undefined> {
  const data = await page.evaluate(() => {
    const attr = (selector: string, name: string): string | undefined =>
      document.querySelector(selector)?.getAttribute(name)?.trim() || undefined;
    const meta = (key: string): string | undefined =>
      document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute("content")?.trim() || undefined;
    return {
      canonical: attr('link[rel~="canonical"]', "href"),
      ogUrl: meta("og:url"),
      title: meta("og:title") ?? meta("twitter:title") ?? document.title,
      excerpt: meta("description") ?? meta("og:description") ?? meta("twitter:description"),
      href: window.location.href
    };
  });
  const url = [data.canonical, data.ogUrl, data.href]
    .map((candidate) => resolveUrl(candidate, data.href))
    .find((candidate) => isUsableArticleUrl(candidate));
  if (!url) return undefined;
  return {
    url,
    title: data.title?.replace(/\s+/g, " ").trim(),
    excerpt: data.excerpt?.replace(/\s+/g, " ").trim()
  };
}

async function gotoBrowserPage(page: Page, url: string): Promise<boolean> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: articleBrowserTimeoutMs });
  await page.waitForTimeout(350).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  return !isLikelyBrowserChallenge(page.url(), title, bodyText);
}

async function browserArticlePageResolution(page: Page, url: string): Promise<NewsArticleResolution | undefined> {
  const ok = await gotoBrowserPage(page, url).catch(() => false);
  if (!ok) return undefined;
  return parseBrowserArticlePage(page);
}

async function firstBrowserSearchResultUrl(page: Page, baseUrl: string): Promise<string | undefined> {
  const hrefs = await page.$$eval("a[href]", (anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).href).slice(0, 100)
  );
  for (const href of hrefs) {
    const candidate = unwrapGoogleResultUrl(href, baseUrl);
    if (!candidate || !isUsableArticleUrl(candidate)) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.hostname.endsWith("google.com") || parsed.hostname === "webcache.googleusercontent.com") continue;
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function browserNewsArticleResolver(input: NewsArticleResolveInput): Promise<NewsArticleResolution | undefined> {
  if (!isNewsBrowserResolverEnabled()) return undefined;
  let browser: Awaited<ReturnType<typeof import("playwright")["chromium"]["launch"]>> | undefined;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: browserUserAgent,
      locale: "ja-JP",
      timezoneId: "Asia/Tokyo",
      viewport: { width: 1365, height: 900 },
      extraHTTPHeaders: {
        "Accept-Language": "ja,en-US;q=0.8,en;q=0.6"
      }
    });
    const page = await context.newPage();
    try {
      if (input.candidateUrl) {
        const direct = await browserArticlePageResolution(page, input.candidateUrl);
        if (direct) return direct;
      }
      const searchUrl = googleSearchUrl(input);
      const searchOk = await gotoBrowserPage(page, searchUrl).catch(() => false);
      if (!searchOk) return undefined;
      const resultUrl = await firstBrowserSearchResultUrl(page, page.url());
      if (!resultUrl) return undefined;
      return await browserArticlePageResolution(page, resultUrl) ?? { url: resultUrl };
    } finally {
      await context.close().catch(() => undefined);
    }
  } catch {
    return undefined;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function defaultNewsArticleResolver(input: NewsArticleResolveInput): Promise<NewsArticleResolution | undefined> {
  if (input.candidateUrl) {
    try {
      const html = await defaultHtmlFetcher(input.candidateUrl);
      const resolved = parseArticlePage(html, input.candidateUrl);
      if (resolved) return resolved;
    } catch {
      // Fall through to a title/source search.
    }
  }
  try {
    const searchUrl = googleSearchUrl(input);
    const searchHtml = await defaultHtmlFetcher(searchUrl);
    const resultUrl = firstSearchResultUrl(searchHtml, searchUrl);
    if (!resultUrl) return await browserNewsArticleResolver(input);
    try {
      const html = await defaultHtmlFetcher(resultUrl);
      return parseArticlePage(html, resultUrl) ?? { url: resultUrl };
    } catch {
      return { url: resultUrl };
    }
  } catch {
    return browserNewsArticleResolver(input);
  }
}

function extractTagText(item: string, tag: string): string | undefined {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = item.match(pattern);
  if (!match) return undefined;
  const raw = match[1] ?? "";
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const inner = cdata ? cdata[1] : raw;
  return decodeXmlEntities(inner).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractRawTagText(item: string, tag: string): string | undefined {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = item.match(pattern);
  if (!match) return undefined;
  const raw = match[1] ?? "";
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const inner = cdata ? cdata[1] : raw;
  return decodeXmlEntities(inner).trim();
}

function extractLink(item: string): string | undefined {
  const hrefMatch = item.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  if (hrefMatch?.[1]) return hrefMatch[1].trim();
  const inline = item.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  if (!inline?.[1]) return undefined;
  const value = decodeXmlEntities(inline[1].replace(/<[^>]+>/g, " ").trim());
  return value || undefined;
}

function extractSource(item: string): { label?: string; url?: string } {
  const match = item.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
  if (!match) return {};
  const attrs = match[1] ?? "";
  const url = attrs.match(/\burl=["']([^"']+)["']/i)?.[1]?.trim();
  const label = decodeXmlEntities((match[2] ?? "").replace(/<[^>]+>/g, " ").trim());
  return { label: label || undefined, url };
}

function isGoogleNewsIntermediateUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.hostname === "news.google.com" && parsed.pathname.includes("/rss/articles/");
  } catch {
    return false;
  }
}

function isUsableArticleUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.hostname.endsWith("google.com") && !isGoogleNewsIntermediateUrl(value);
  } catch {
    return false;
  }
}

function extractHtmlArticleHref(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) continue;
    const matches = value.matchAll(/\bhref=["'](https?:\/\/[^"']+)["']/gi);
    for (const match of matches) {
      const url = decodeXmlEntities(match[1] ?? "").trim();
      if (isUsableArticleUrl(url)) return url;
    }
  }
  return undefined;
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
    const rawTitle = extractRawTagText(item, "title");
    const rawDescription =
      extractRawTagText(item, "description") ??
      extractRawTagText(item, "summary") ??
      extractRawTagText(item, "content");
    const title = extractTagText(item, "title");
    if (!title) continue;
    const description =
      extractTagText(item, "description") ??
      extractTagText(item, "summary") ??
      extractTagText(item, "content");
    const text = [title, description].filter(Boolean).join(" — ").slice(0, 320);
    if (!text) continue;
    if (secretLikePattern.test(text)) continue;
    const sourceInfo = extractSource(item);
    const link = extractLink(item);
    const articleHref = extractHtmlArticleHref(rawTitle, rawDescription);
    const url = articleHref ?? (isUsableArticleUrl(link) ? link : undefined);
    entries.push({
      text,
      url,
      lookupUrl: !url && isGoogleNewsIntermediateUrl(link) ? link : undefined,
      postedAt: extractPubDate(item),
      source: sourceInfo.label ?? source
    });
  }
  return entries;
}

function renderTextWithResolution(entry: NewsObservationEntry, resolution: NewsArticleResolution): string {
  const title = resolution.title?.trim();
  const excerpt = resolution.excerpt?.trim();
  if (!title && !excerpt) return entry.text;
  const combined = [title, excerpt].filter(Boolean).join(" — ");
  return combined.slice(0, 320) || entry.text;
}

async function resolveArticleUrls(
  entries: NewsObservationEntry[],
  resolver: NewsArticleResolver | undefined
): Promise<NewsObservationEntry[]> {
  if (!resolver) {
    return entries.map(({ lookupUrl: _lookupUrl, ...entry }) => entry);
  }
  const resolved: NewsObservationEntry[] = [];
  let resolutionCount = 0;
  for (const entry of entries) {
    if (entry.url || !entry.lookupUrl || resolutionCount >= maxArticleResolutionsPerRun) {
      const { lookupUrl: _lookupUrl, ...clean } = entry;
      resolved.push(clean);
      continue;
    }
    resolutionCount += 1;
    const resolution = await resolver({
      title: entry.text.split(" — ")[0] ?? entry.text,
      text: entry.text,
      source: entry.source,
      candidateUrl: entry.lookupUrl
    }).catch(() => undefined);
    const { lookupUrl: _lookupUrl, ...clean } = entry;
    if (!resolution?.url || !isUsableArticleUrl(resolution.url)) {
      resolved.push(clean);
      continue;
    }
    resolved.push({
      ...clean,
      text: renderTextWithResolution(clean, resolution),
      url: resolution.url,
      source: resolution.source ?? clean.source
    });
  }
  return resolved;
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
    const parsed = new URL(url);
    if (parsed.hostname === "news.google.com" && parsed.pathname.includes("/rss/search")) {
      return "news.google.com/search";
    }
    return parsed.hostname;
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
  const motifs = extractPersonaMotifs(context.personaText);
  const urls = newsRssUrlsForRun(motifs);
  const path = newsCachePath(root, now);
  if (urls.length === 0) {
    return { status: "skipped", path, entries: [], reason: "news_motifs_unavailable_and_OPENCLAW_NEWS_RSS_URLS_unset" };
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
  const fetcher = context.fetcher ?? defaultFetcher;
  const articleResolver = context.articleResolver ?? (context.fetcher || !isNewsArticleResolverEnabled() ? undefined : defaultNewsArticleResolver);
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
  const resolved = await resolveArticleUrls(collected, articleResolver);
  if (secretLikePattern.test(resolved.map((entry) => entry.text).join("\n"))) {
    throw new Error("news_observation_contains_secret_like_text");
  }
  const annotated = rankAndAnnotate(resolved, motifs);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${renderNewsObservation(annotated, now).trim()}\n`, "utf8");
  return { status: "collected", path, entries: annotated };
}
