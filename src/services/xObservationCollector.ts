import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isBirdBanIndication, recordBirdCall, triggerCooldown, tryAcquireBirdCall } from "./birdRateLimiter.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { secretLikePattern } from "./personaMigrator.js";
import { planQueryStrategy } from "./xQueryStrategyPlanner.js";

export interface XObservationContext {
  personaText?: string;
  query?: string;
  observationHistory?: string;
  manualSeed?: { hint?: string };
  now?: Date;
  runner?: () => Promise<{ stdout: string; stderr?: string }>;
}

export interface XObservationResult {
  status: "collected" | "cached" | "skipped" | "cooldown";
  path: string;
  observations: string;
  reason?: string;
}

export interface XObservationEntry {
  text: string;
  author?: string;
  url?: string;
  postedAt?: string;
}

const tweetUrlPattern = /https:\/\/(?:t\.co\/[A-Za-z0-9]+|(?:twitter|x)\.com\/[^/\s]+\/status\/\d+)/i;
const authorPattern = /(?:^|\s)@([A-Za-z0-9_]{1,20})\b/;
const isoDatePattern = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/;
const observationCacheTtlMs = 6 * 60 * 60 * 1000;

function jstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function observationPath(root: string, now = new Date()): string {
  return join(root, "observations", `${jstDate(now)}.md`);
}

function defaultRunner(query?: string): () => Promise<{ stdout: string; stderr?: string }> {
  return async () => {
    const args = query ? ["search", query, "--plain"] : ["timeline", "--plain"];
    const { execFile } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      execFile("bird", args, { timeout: 30_000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  };
}

function parseBirdOutput(source: string): XObservationEntry[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const url = line.match(tweetUrlPattern)?.[0];
      const author = line.match(authorPattern)?.[1] ?? url?.match(/(?:twitter|x)\.com\/([^/\s]+)\/status/i)?.[1];
      const postedAt = line.match(isoDatePattern)?.[0];
      const text = line
        .replace(tweetUrlPattern, "")
        .replace(isoDatePattern, "")
        .replace(/\s+/g, " ")
        .trim();
      return { text: text || line, author, url, postedAt };
    });
}

function filterObservationEntries(source: string, personaText?: string): XObservationEntry[] {
  const personaWords = new Set(
    (personaText ?? "")
      .toLowerCase()
      .split(/[^a-z0-9一-龠ぁ-んァ-ヶー]+/i)
      .filter((word) => word.length >= 3)
      .slice(0, 80)
  );
  const entries = parseBirdOutput(source);
  if (personaWords.size === 0) {
    return entries.slice(0, 12);
  }
  const matched = entries.filter((entry) => {
    const lower = `${entry.text} ${entry.author ?? ""}`.toLowerCase();
    return [...personaWords].some((word) => lower.includes(word));
  });
  return (matched.length > 0 ? matched : entries).slice(0, 12);
}

function jsonValue(value: string | undefined): string {
  return value ? JSON.stringify(value) : "null";
}

function renderObservation(entries: XObservationEntry[], now: Date, query?: string): string {
  return [
    `# X Observations ${jstDate(now)}`,
    "",
    query ? `Query: ${query}` : "Source: timeline",
    "",
    ...entries.flatMap((entry) => [
      `- text: ${JSON.stringify(entry.text)}`,
      `  author: ${jsonValue(entry.author)}`,
      `  url: ${jsonValue(entry.url)}`,
      `  postedAt: ${jsonValue(entry.postedAt)}`
    ])
  ].join("\n");
}

export async function readTodayObservations(root: string, now = new Date()): Promise<string> {
  return readFile(observationPath(root, now), "utf8").catch(() => "");
}

export interface ObservationReport {
  date: string;
  path: string;
  exists: boolean;
  query?: string;
  entries: XObservationEntry[];
}

const isoDateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

function parseObservationFile(content: string): { query?: string; entries: XObservationEntry[] } {
  const lines = content.split(/\r?\n/);
  const queryLine = lines.find((line) => /^Query:\s+/i.test(line) || /^Source:\s+/i.test(line));
  const query = queryLine?.replace(/^(?:Query|Source):\s+/i, "").trim();
  const entries: XObservationEntry[] = [];
  let current: Partial<XObservationEntry> | undefined;
  let usedKeyedFormat = false;
  for (const rawLine of lines) {
    const textMatch = rawLine.match(/^-\s+text:\s+(.*)$/);
    if (textMatch) {
      usedKeyedFormat = true;
      if (current?.text) {
        entries.push({ ...current, text: current.text } as XObservationEntry);
      }
      current = { text: parseQuoted(textMatch[1]) };
      continue;
    }
    if (!current) continue;
    const authorMatch = rawLine.match(/^\s+author:\s+(.*)$/);
    if (authorMatch) {
      current.author = parseQuoted(authorMatch[1]) || undefined;
      continue;
    }
    const urlMatch = rawLine.match(/^\s+url:\s+(.*)$/);
    if (urlMatch) {
      current.url = parseQuoted(urlMatch[1]) || undefined;
      continue;
    }
    const postedMatch = rawLine.match(/^\s+postedAt:\s+(.*)$/);
    if (postedMatch) {
      current.postedAt = parseQuoted(postedMatch[1]) || undefined;
    }
  }
  if (current?.text) {
    entries.push({ ...current, text: current.text } as XObservationEntry);
  }
  if (!usedKeyedFormat && entries.length === 0) {
    for (const rawLine of lines) {
      const legacy = rawLine.match(/^-\s+(.*)$/);
      if (!legacy) continue;
      const body = legacy[1].trim();
      if (!body) continue;
      const url = body.match(tweetUrlPattern)?.[0];
      const authorTag = body.match(authorPattern)?.[1] ?? url?.match(/(?:twitter|x)\.com\/([^/\s]+)\/status/i)?.[1];
      const postedAt = body.match(isoDatePattern)?.[0];
      const text = body
        .replace(tweetUrlPattern, "")
        .replace(isoDatePattern, "")
        .replace(/\s+/g, " ")
        .trim();
      entries.push({ text: text || body, author: authorTag, url, postedAt });
    }
  }
  return { query, entries };
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

export async function readObservationsReport(root: string, dateOrNow: string | Date = new Date()): Promise<ObservationReport> {
  const now = typeof dateOrNow === "string" && isoDateOnlyPattern.test(dateOrNow)
    ? new Date(`${dateOrNow}T00:00:00+09:00`)
    : dateOrNow instanceof Date
      ? dateOrNow
      : new Date();
  const date = jstDate(now);
  const path = observationPath(root, now);
  const content = await readFile(path, "utf8").catch(() => "");
  if (!content) {
    return { date, path, exists: false, entries: [] };
  }
  const { query, entries } = parseObservationFile(content);
  return { date, path, exists: true, query, entries };
}

export async function collectObservations(root: string, context: XObservationContext = {}): Promise<XObservationResult> {
  const now = context.now ?? new Date();
  const path = observationPath(root, now);
  const cached = await readFile(path, "utf8").catch(() => "");
  if (cached) {
    const cachedStat = await stat(path).catch(() => undefined);
    if (cachedStat && now.getTime() - cachedStat.mtime.getTime() < observationCacheTtlMs) {
      return { status: "cached", path, observations: cached };
    }
  }
  const strategy = await planQueryStrategy({
    personaText: context.personaText,
    observationHistory: context.observationHistory,
    manualSeed: context.manualSeed
  });
  const gate = await tryAcquireBirdCall(root, now);
  if (!gate.allowed) {
    const status = gate.cooldownUntil ? "cooldown" : "skipped";
    return { status, path, observations: "", reason: gate.reason };
  }
  const runner = context.runner ?? defaultRunner(context.query ?? strategy.query);
  try {
    const result = await runner();
    const combined = `${result.stdout}\n${result.stderr ?? ""}`;
    if (isBirdBanIndication(combined)) {
      await recordBirdCall(root, now, { query: context.query ?? strategy.query, mode: strategy.mode });
      await triggerCooldown(root, combined.slice(0, 240), now);
      emitRuntimeEvent({
        type: "bird_cooldown_triggered",
        reason: "bird returned a rate-limit or ban indication",
        cooldownUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        timestamp: now.getTime()
      });
      return { status: "cooldown", path, observations: "", reason: "bird returned a rate-limit or ban indication" };
    }
    if (secretLikePattern.test(result.stdout)) {
      throw new Error("x_observation_contains_secret_like_text");
    }
    await recordBirdCall(root, now, { query: context.query ?? strategy.query, mode: strategy.mode });
    const observations = renderObservation(filterObservationEntries(result.stdout, context.personaText), now, context.query ?? strategy.query);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${observations.trim()}\n`, "utf8");
    return { status: "collected", path, observations };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordBirdCall(root, now, { query: context.query ?? strategy.query, mode: strategy.mode });
    if (isBirdBanIndication(message)) {
      await triggerCooldown(root, message, now);
      emitRuntimeEvent({
        type: "bird_cooldown_triggered",
        reason: message,
        cooldownUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        timestamp: now.getTime()
      });
      return { status: "cooldown", path, observations: "", reason: message };
    }
    return { status: "skipped", path, observations: "", reason: message };
  }
}
