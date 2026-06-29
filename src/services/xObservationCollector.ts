import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isBirdBanIndication, recordBirdCall, triggerCooldown, tryAcquireBirdCall } from "./birdRateLimiter.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { secretLikePattern } from "./personaMigrator.js";
import { planQueryStrategy } from "./xQueryStrategyPlanner.js";
import { extractPersonaMotifs, summarizeMotifs, type PersonaMotifBundle } from "./personaMotifExtractor.js";
import { rankObservations, summarizeMatches, type ScoredObservation } from "./xObservationScorer.js";

export interface XObservationContext {
  personaText?: string;
  query?: string;
  reactionSeed?: {
    title: string;
    url?: string;
    source?: string;
  };
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
  motifMatch?: string;
  motifScore?: number;
}

const tweetUrlPattern = /https:\/\/(?:t\.co\/[A-Za-z0-9]+|(?:twitter|x)\.com\/[^/\s]+\/status\/\d+)/i;
const fullTweetUrlPattern = /https:\/\/(?:twitter|x)\.com\/[^/\s]+\/status\/\d+/i;
const authorPattern = /(?:^|\s)@([A-Za-z0-9_]{1,20})\b/;
const isoDatePattern = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z\b/;
const observationCacheTtlMs = 6 * 60 * 60 * 1000;

type RejectionReason = "short_url_only" | "missing_author" | "missing_postedAt";

interface RejectedEntry {
  text: string;
  author?: string;
  url?: string;
  postedAt?: string;
  reason: RejectionReason;
}

function isAcceptable(
  entry: XObservationEntry
): { ok: true } | { ok: false; reason: RejectionReason } {
  if (!entry.url || !fullTweetUrlPattern.test(entry.url)) {
    return { ok: false, reason: "short_url_only" };
  }
  if (!entry.author || entry.author === "_") {
    return { ok: false, reason: "missing_author" };
  }
  if (!entry.postedAt) {
    return { ok: false, reason: "missing_postedAt" };
  }
  return { ok: true };
}

async function appendRejectedLog(
  root: string,
  now: Date,
  rejected: RejectedEntry[]
): Promise<void> {
  if (rejected.length === 0) return;
  const logPath = join(root, "runtime", "x-observation-rejected.jsonl");
  await mkdir(dirname(logPath), { recursive: true });
  const rejectedAt = now.toISOString();
  const lines = rejected
    .map((entry) => JSON.stringify({ ...entry, rejectedAt }))
    .join("\n");
  await appendFile(logPath, `${lines}\n`, "utf8");
}

function jstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function observationPath(root: string, now = new Date()): string {
  return join(root, "observations", `${jstDate(now)}.md`);
}

function defaultRunner(query?: string): () => Promise<{ stdout: string; stderr?: string }> {
  return async () => {
    const args = query ? ["search", query, "--plain"] : ["home", "--plain"];
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

const recordSeparatorPattern = /\r?\n─{10,}\r?\n/;

function parseBirdChunk(chunk: string): XObservationEntry {
  const lines = chunk.split(/\r?\n/);
  let author: string | undefined;
  let url: string | undefined;
  let postedAt: string | undefined;
  const textParts: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!author) {
      const head = line.match(/^@([A-Za-z0-9_]{1,20})(?:\s*\(([^)]*)\))?:\s*(.*)$/);
      if (head) {
        author = head[1];
        if (head[3]) textParts.push(head[3]);
        continue;
      }
    }
    const dateMatch = line.match(/^date:\s+(.+)$/i);
    if (dateMatch) {
      postedAt = dateMatch[1].trim();
      continue;
    }
    const urlMatch = line.match(/^url:\s+(\S+)/i);
    if (urlMatch) {
      url = urlMatch[1].trim();
      continue;
    }
    if (/^(PHOTO|VIDEO):/i.test(line)) continue;
    textParts.push(line);
  }
  if (!author) {
    const fallbackAuthor = chunk.match(authorPattern)?.[1] ?? url?.match(/(?:twitter|x)\.com\/([^/\s]+)\/status/i)?.[1];
    if (fallbackAuthor) author = fallbackAuthor;
  }
  if (!url) {
    url = chunk.match(tweetUrlPattern)?.[0];
  }
  const text = textParts.join(" ").replace(/\s+/g, " ").trim();
  return { text, author, url, postedAt };
}

function parseBirdLines(source: string): XObservationEntry[] {
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

function parseBirdOutput(source: string): XObservationEntry[] {
  const trimmed = source.trim();
  if (!trimmed) return [];
  if (recordSeparatorPattern.test(trimmed)) {
    return trimmed
      .split(recordSeparatorPattern)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => parseBirdChunk(chunk));
  }
  return parseBirdLines(trimmed);
}

function filterObservationEntries(
  source: string,
  motifs: PersonaMotifBundle
): { entries: XObservationEntry[]; scored: ScoredObservation<XObservationEntry>[]; rejected: RejectedEntry[] } {
  const parsed = parseBirdOutput(source);
  const accepted: XObservationEntry[] = [];
  const rejected: RejectedEntry[] = [];
  for (const entry of parsed) {
    const check = isAcceptable(entry);
    if (check.ok) {
      accepted.push(entry);
    } else {
      rejected.push({ ...entry, reason: check.reason });
    }
  }
  const ranked = rankObservations(accepted, motifs);
  const entries = ranked.map((scored) => ({
    ...scored.entry,
    motifMatch: scored.matched.length > 0 ? summarizeMatches(scored) : undefined,
    motifScore: scored.score
  }));
  return { entries, scored: ranked, rejected };
}

function jsonValue(value: string | undefined): string {
  return value ? JSON.stringify(value) : "null";
}

function renderObservation(
  entries: XObservationEntry[],
  now: Date,
  query?: string,
  motifs?: PersonaMotifBundle,
  reactionSeed?: XObservationContext["reactionSeed"]
): string {
  const motifLine = motifs ? summarizeMotifs(motifs) : "";
  const lines = [
    `# X Observations ${jstDate(now)}`,
    "",
    query ? `Query: ${query}` : "Source: timeline"
  ];
  if (reactionSeed) {
    lines.push(`ReactionFor: ${JSON.stringify(reactionSeed.title)}`);
    if (reactionSeed.url) lines.push(`ReactionUrl: ${JSON.stringify(reactionSeed.url)}`);
    if (reactionSeed.source) lines.push(`ReactionSource: ${JSON.stringify(reactionSeed.source)}`);
  }
  if (motifLine) {
    lines.push(`Motifs: ${motifLine}`);
  }
  lines.push("");
  for (const entry of entries) {
    lines.push(`- text: ${JSON.stringify(entry.text)}`);
    lines.push(`  author: ${jsonValue(entry.author)}`);
    lines.push(`  url: ${jsonValue(entry.url)}`);
    lines.push(`  postedAt: ${jsonValue(entry.postedAt)}`);
    if (entry.motifMatch) {
      lines.push(`  motifMatch: ${JSON.stringify(entry.motifMatch)}`);
    }
    if (typeof entry.motifScore === "number" && entry.motifScore !== 0) {
      lines.push(`  motifScore: ${entry.motifScore}`);
    }
  }
  return lines.join("\n");
}

export async function readTodayObservations(root: string, now = new Date()): Promise<string> {
  return readFile(observationPath(root, now), "utf8").catch(() => "");
}

export interface ObservationReport {
  date: string;
  path: string;
  exists: boolean;
  query?: string;
  reactionSeed?: {
    title: string;
    url?: string;
    source?: string;
  };
  entries: XObservationEntry[];
}

const isoDateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

function parseObservationFile(content: string): { query?: string; reactionSeed?: ObservationReport["reactionSeed"]; entries: XObservationEntry[] } {
  const lines = content.split(/\r?\n/);
  const queryLine = lines.find((line) => /^Query:\s+/i.test(line) || /^Source:\s+/i.test(line));
  const query = queryLine?.replace(/^(?:Query|Source):\s+/i, "").trim();
  const reactionTitle = lines.find((line) => /^ReactionFor:\s+/i.test(line))?.replace(/^ReactionFor:\s+/i, "").trim();
  const reactionUrl = lines.find((line) => /^ReactionUrl:\s+/i.test(line))?.replace(/^ReactionUrl:\s+/i, "").trim();
  const reactionSource = lines.find((line) => /^ReactionSource:\s+/i.test(line))?.replace(/^ReactionSource:\s+/i, "").trim();
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
      continue;
    }
    const motifMatch = rawLine.match(/^\s+motifMatch:\s+(.*)$/);
    if (motifMatch) {
      current.motifMatch = parseQuoted(motifMatch[1]) || undefined;
      continue;
    }
    const motifScoreMatch = rawLine.match(/^\s+motifScore:\s+(-?\d+)$/);
    if (motifScoreMatch) {
      const parsed = Number.parseInt(motifScoreMatch[1], 10);
      current.motifScore = Number.isFinite(parsed) ? parsed : undefined;
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
  return {
    query,
    reactionSeed: reactionTitle ? {
      title: parseQuoted(reactionTitle),
      url: parseQuoted(reactionUrl ?? "") || undefined,
      source: parseQuoted(reactionSource ?? "") || undefined
    } : undefined,
    entries
  };
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
  const { query, reactionSeed, entries } = parseObservationFile(content);
  return { date, path, exists: true, query, reactionSeed, entries };
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
  const motifs = extractPersonaMotifs(context.personaText);
  const strategy = await planQueryStrategy({
    personaText: context.personaText,
    observationHistory: context.observationHistory,
    manualSeed: context.manualSeed,
    motifs
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
    const filtered = filterObservationEntries(result.stdout, motifs);
    await appendRejectedLog(root, now, filtered.rejected);
    const observations = renderObservation(filtered.entries, now, context.query ?? strategy.query, motifs, context.reactionSeed);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${observations.trim()}\n`, "utf8");
    const topScored = filtered.scored[0];
    emitRuntimeEvent({
      type: "observation_collected",
      topMotifMatch: topScored?.matched.length ? topScored.entry.motifMatch : undefined,
      topScore: topScored?.score,
      entryCount: filtered.entries.length,
      timestamp: now.getTime()
    });
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
