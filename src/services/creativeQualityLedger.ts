import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CreativeDecision } from "../types.js";

export interface CreativeQualityEntry {
  songId: string;
  title: string;
  createdAt: string;
  dopagakiActive: boolean;
  dopagakiThreshold: number;
  bareLyricsChars: number;
  bareLines: number;
  moodHint: string;
  // Optional fields were added after the ledger first shipped. Readers must
  // continue accepting earlier append-only entries without them.
  hookText?: string;
  tempoBand?: "slow" | "mid" | "up" | "dopagaki" | "super";
  emotionalMode?: string;
  introArchetype?: string;
  // The full creative decision that shaped this song, when available. Carried so
  // the director's per-axis history (lens, stance, hook, tag, aggression) can be
  // read back for cross-axis anti-repeat and status distributions.
  decision?: CreativeDecision;
  dissBankHits: string[];
  dissBankHitCount: number;
  degraded: boolean;
}

export interface CreativeQualityAggregate {
  sampleSize: number;
  dopagakiRate: number;
  averageBareChars: number;
  averageBareLines: number;
  averageDissBankHits: number;
  // Per-axis distributions over the window. Empty when no entry carries a
  // decision (older ledgers). disRate is the share of decisions with
  // aggression === "dis".
  lensCounts: Record<string, number>;
  emotionalModeCounts: Record<string, number>;
  attackStanceCounts: Record<string, number>;
  disRate: number;
  decisionSampleSize: number;
}

export function creativeQualityLedgerPath(root: string): string {
  return join(root, "runtime", "creative-quality-ledger.jsonl");
}

// Rolling view over the newest window (default 20 songs) so the operator can
// see whether the dopagaki target rate and density are actually landing.
export function aggregateCreativeQuality(entries: CreativeQualityEntry[]): CreativeQualityAggregate {
  const sampleSize = entries.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      dopagakiRate: 0,
      averageBareChars: 0,
      averageBareLines: 0,
      averageDissBankHits: 0,
      lensCounts: {},
      emotionalModeCounts: {},
      attackStanceCounts: {},
      disRate: 0,
      decisionSampleSize: 0
    };
  }
  const dopagakiCount = entries.filter((entry) => entry.dopagakiActive).length;
  const totals = entries.reduce(
    (acc, entry) => {
      acc.chars += entry.bareLyricsChars;
      acc.lines += entry.bareLines;
      acc.hits += entry.dissBankHitCount;
      return acc;
    },
    { chars: 0, lines: 0, hits: 0 }
  );
  const round = (value: number, decimals: number) => {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  };
  const decisions = entries
    .map((entry) => entry.decision)
    .filter((decision): decision is CreativeDecision => Boolean(decision));
  const lensCounts: Record<string, number> = {};
  const emotionalModeCounts: Record<string, number> = {};
  const attackStanceCounts: Record<string, number> = {};
  let disCount = 0;
  for (const decision of decisions) {
    lensCounts[decision.lens] = (lensCounts[decision.lens] ?? 0) + 1;
    emotionalModeCounts[decision.emotionalMode.label] =
      (emotionalModeCounts[decision.emotionalMode.label] ?? 0) + 1;
    attackStanceCounts[decision.attackStance] = (attackStanceCounts[decision.attackStance] ?? 0) + 1;
    if (decision.aggression === "dis") disCount += 1;
  }
  return {
    sampleSize,
    dopagakiRate: round(dopagakiCount / sampleSize, 4),
    averageBareChars: round(totals.chars / sampleSize, 1),
    averageBareLines: round(totals.lines / sampleSize, 1),
    averageDissBankHits: round(totals.hits / sampleSize, 2),
    lensCounts,
    emotionalModeCounts,
    attackStanceCounts,
    disRate: decisions.length > 0 ? round(disCount / decisions.length, 4) : 0,
    decisionSampleSize: decisions.length
  };
}

export async function appendCreativeQualityEntry(root: string, entry: CreativeQualityEntry): Promise<CreativeQualityEntry> {
  const path = creativeQualityLedgerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

// Returns entries newest-first. Corrupt lines are skipped so one bad append
// never blinds the whole telemetry view.
export async function readCreativeQualityLedger(root: string, limit?: number): Promise<CreativeQualityEntry[]> {
  const raw = await readFile(creativeQualityLedgerPath(root), "utf8").catch(() => "");
  if (!raw.trim()) return [];
  const entries: CreativeQualityEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as CreativeQualityEntry;
      if (parsed && typeof parsed.songId === "string") {
        entries.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  const newestFirst = entries.reverse();
  return typeof limit === "number" ? newestFirst.slice(0, limit) : newestFirst;
}

export async function readLatestCreativeQualityEntry(root: string, songId: string): Promise<CreativeQualityEntry | undefined> {
  const entries = await readCreativeQualityLedger(root);
  return entries.find((entry) => entry.songId === songId);
}

// Reads the most recent creative decisions from the ledger for the director's
// cross-axis anti-repeat. Returns up to `limit` decisions ordered MOST-RECENT
// LAST (the order the director expects), skipping ledger entries that predate the
// decision field.
export async function readRecentCreativeDecisions(root: string, limit = 6): Promise<CreativeDecision[]> {
  const entries = await readCreativeQualityLedger(root);
  const decisions: CreativeDecision[] = [];
  for (const entry of entries) {
    // entries are newest-first; collect newest `limit` then reverse
    if (entry.decision) decisions.push(entry.decision);
    if (decisions.length >= limit) break;
  }
  return decisions.reverse();
}

const DISS_BANK_HEADING = /^#{1,6}\s+Shibuya Diss Material Bank\s*$/i;
// Kanji (incl. 々), katakana (incl. ー). Hiragana particles break runs so key
// terms stay on distinctive content words.
const KEY_TERM_PATTERN = /[一-鿿々゠-ヿ]{2,}/g;

// Parse the noun phrases of the "### Shibuya Diss Material Bank" bullet items.
// Returns [] when the section is absent (older workspaces must not break).
export function extractDissBankItems(artistMd: string): string[] {
  const lines = artistMd.split(/\r?\n/);
  const start = lines.findIndex((line) => DISS_BANK_HEADING.test(line.trim()));
  if (start < 0) return [];
  const items: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^#{1,6}\s/.test(trimmed)) break; // next heading ends the section
    const bullet = trimmed.match(/^-\s+(.+)$/);
    if (!bullet) continue;
    const nounPhrase = bullet[1].split(/[:：]/)[0].trim();
    if (!nounPhrase) continue;
    if (/^素材の扱い/.test(nounPhrase)) continue; // safety preface, not a material item
    items.push(nounPhrase);
  }
  return items;
}

function keyTermsForItem(nounPhrase: string): string[] {
  return nounPhrase.match(KEY_TERM_PATTERN) ?? [];
}

// Deterministic, AI-free inclusion approximation: a bank item counts as a hit
// when any of its key terms (kanji/katakana runs) appears in the lyrics body.
export function computeDissBankHits(artistMd: string, lyrics: string): string[] {
  const items = extractDissBankItems(artistMd);
  if (items.length === 0) return [];
  const hits: string[] = [];
  for (const item of items) {
    const terms = keyTermsForItem(item);
    if (terms.length === 0) continue;
    if (terms.some((term) => lyrics.includes(term))) {
      hits.push(item);
    }
  }
  return hits;
}
