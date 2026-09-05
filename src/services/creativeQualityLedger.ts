import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CreativeDecision } from "../types.js";
import { SHIBUYA_DISS_MATERIAL_BANK_HEADING, headingMatches } from "./personaHeadings.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

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
  // Phrases from this song's decision.lensMaterial that appeared in the final
  // lyrics. Added after the ledger first shipped; older entries lack it. Read
  // back by the director to keep the next same-lens song off recently-used
  // material.
  usedMaterial?: string[];
  // Catchphrase ids (see creativeDirector.CATCHPHRASES) detected in the final
  // lyrics. Added after the ledger first shipped; older entries lack it. Read
  // back by the director's catchphrase budget and by the monotony watchdog.
  usedCatchphrases?: string[];
  dissBankHits: string[];
  dissBankHitCount: number;
  degraded: boolean;
  // Set when a valid draft still carried an exculpatory ("免罪句") phrase after
  // one regeneration attempt. The draft passes through rather than parking, but
  // the ledger records that the fang was softened so monitoring can see it.
  softened?: boolean;
  // Set when a valid draft still leaked a punchline label or reused a recent
  // song's phrasing after one regeneration attempt. Same pass-through semantics
  // as `softened`: the draft ships but the ledger records the residual.
  repeated?: boolean;
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
  // Active creative streaks detected over the head (newest) of the window. Empty
  // when no monotony run is currently running. See detectCreativeStreaks.
  streaks: CreativeStreak[];
}

// A run of consecutive most-recent songs that repeat the same creative choice.
// `length` is how many newest songs currently share `value` for `kind`.
export interface CreativeStreak {
  kind:
    | "lens"
    | "aggression_changeup"
    | "attack_stance"
    | "intro_archetype"
    | "title_word"
    | "catchphrase"
    | "structure";
  value: string;
  length: number;
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
      decisionSampleSize: 0,
      streaks: []
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
    decisionSampleSize: decisions.length,
    streaks: detectCreativeStreaks(entries)
  };
}

// Length of the run of consecutive newest entries that share the same non-empty
// key. `entries` are newest-first, so the run starts at index 0. Returns the
// shared value and its run length, or undefined when the newest entry has no key
// (an undefined key breaks the run rather than matching another undefined).
function headRun(
  entries: CreativeQualityEntry[],
  keyFn: (entry: CreativeQualityEntry) => string | undefined
): { value: string; length: number } | undefined {
  const first = keyFn(entries[0]);
  if (!first) return undefined;
  let length = 1;
  for (let index = 1; index < entries.length; index += 1) {
    if (keyFn(entries[index]) === first) length += 1;
    else break;
  }
  return { value: first, length };
}

function introArchetypeOf(entry: CreativeQualityEntry): string | undefined {
  const value = entry.decision?.intro.archetype ?? entry.introArchetype;
  // artist_led is a writing contract, not a repeated sonic form. Treating it as
  // an archetype would generate a false monotony warning for every new song.
  return value === "artist_led" ? undefined : value;
}

// >=2-char kanji/katakana content words in a title. Reuses the module's existing
// key-term pattern so titles and diss-bank items are tokenized the same way.
function titleTerms(title: string): string[] {
  return title.match(KEY_TERM_PATTERN) ?? [];
}

// Detects the "Face x4" class of monotony from the newest entries. Each detector
// measures a run at the head of the window; a run at or over its threshold is a
// live streak. Entries are expected newest-first.
export function detectCreativeStreaks(entries: CreativeQualityEntry[]): CreativeStreak[] {
  if (entries.length === 0) return [];
  const streaks: CreativeStreak[] = [];

  const lens = headRun(entries, (entry) => entry.decision?.lens);
  if (lens && lens.length >= 3) streaks.push({ kind: "lens", value: lens.value, length: lens.length });

  // Structure: the director weights standard 1/2 and never repeats the previous
  // song's structure, so 2-in-a-row is expected and only 3-in-a-row signals the
  // anti-repeat broke down (or plans are missing). headRun's undefined-breaks-run
  // behavior already treats a missing decision.structure as unknown and
  // non-matching, so older ledger entries without the field never fabricate a
  // streak.
  const structure = headRun(entries, (entry) => entry.decision?.structure);
  if (structure && structure.length >= 3) {
    streaks.push({ kind: "structure", value: structure.value, length: structure.length });
  }

  const changeup = headRun(entries, (entry) =>
    entry.decision?.aggression === "changeup" ? "changeup" : undefined
  );
  if (changeup && changeup.length >= 2) {
    streaks.push({ kind: "aggression_changeup", value: "changeup", length: changeup.length });
  }

  const stance = headRun(entries, (entry) => entry.decision?.attackStance);
  if (stance && stance.length >= 2) {
    streaks.push({ kind: "attack_stance", value: stance.value, length: stance.length });
  }

  const intro = headRun(entries, introArchetypeOf);
  if (intro && intro.length >= 2) {
    streaks.push({ kind: "intro_archetype", value: intro.value, length: intro.length });
  }

  // Title word: a term shared by the two newest titles, then extended downward
  // while consecutive titles keep it. When several terms qualify, the one with
  // the longest run wins (ties resolved by the newest title's term order).
  if (entries.length >= 2) {
    const newestTerms = titleTerms(entries[0].title);
    const secondTerms = new Set(titleTerms(entries[1].title));
    let best: { value: string; length: number } | undefined;
    for (const term of newestTerms) {
      if (!secondTerms.has(term)) continue;
      let length = 2;
      for (let index = 2; index < entries.length; index += 1) {
        if (titleTerms(entries[index].title).includes(term)) length += 1;
        else break;
      }
      if (!best || length > best.length) best = { value: term, length };
    }
    if (best) streaks.push({ kind: "title_word", value: best.value, length: best.length });
  }

  // Catchphrase: a catchphrase id shared by the two newest songs' usedCatchphrases,
  // extended downward while consecutive songs keep it. The director bans the
  // previous song's ids, so a 2-in-a-row here means the ban was ignored (or the
  // older song predates the budget). Same shape as the title-word detector.
  if (entries.length >= 2) {
    const newestIds = entries[0].usedCatchphrases ?? [];
    const secondIds = new Set(entries[1].usedCatchphrases ?? []);
    let best: { value: string; length: number } | undefined;
    for (const id of newestIds) {
      if (!secondIds.has(id)) continue;
      let length = 2;
      for (let index = 2; index < entries.length; index += 1) {
        if ((entries[index].usedCatchphrases ?? []).includes(id)) length += 1;
        else break;
      }
      if (!best || length > best.length) best = { value: id, length };
    }
    if (best) streaks.push({ kind: "catchphrase", value: best.value, length: best.length });
  }

  return streaks;
}

// Signature of a streak set for once-per-incident dedup. Deliberately EXCLUDES
// length: a streak growing 3 -> 4 -> 5 is the same incident, so notifying again
// on each new song would spam. The incident is the (kind, value) set.
export function creativeStreakSignature(streaks: CreativeStreak[]): string {
  return streaks
    .map((streak) => `${streak.kind}:${streak.value}`)
    .sort()
    .join("|");
}

const STREAK_KIND_LABELS: Record<CreativeStreak["kind"], string> = {
  lens: "レンズ",
  aggression_changeup: "アグレッション(changeup)",
  attack_stance: "攻め筋",
  intro_archetype: "イントロ型",
  title_word: "タイトル語",
  catchphrase: "決め句",
  structure: "構成"
};

// Short Japanese description naming the streaks, for the Telegram notice and the
// runtime event detail.
export function describeCreativeStreaks(streaks: CreativeStreak[]): string {
  return streaks
    .map((streak) => `${STREAK_KIND_LABELS[streak.kind]}「${streak.value}」が${streak.length}曲連続`)
    .join("、");
}

export function creativeMonotonyTombstonePath(root: string): string {
  return join(root, "runtime", "creative-monotony-tombstone.json");
}

interface CreativeMonotonyTombstone {
  signature: string;
  detail: string;
  notifiedAt: string;
}

async function readMonotonyTombstone(root: string): Promise<CreativeMonotonyTombstone | undefined> {
  const raw = await readFile(creativeMonotonyTombstonePath(root), "utf8").catch(() => "");
  if (!raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as CreativeMonotonyTombstone;
    return typeof parsed?.signature === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface CreativeMonotonyEvaluation {
  streaks: CreativeStreak[];
  notified: boolean;
}

// The monotony watchdog. Reads the ledger tail, detects streaks, and on a NEW
// incident emits `creative_monotony_warning` (which the subscribed Telegram
// notifier turns into one producer notice) exactly once. The tombstone keyed by
// the streak signature enforces once-per-incident across process restarts; it is
// cleared when the streak breaks so a later recurrence notifies again.
export async function evaluateCreativeMonotony(
  root: string,
  windowSize = 20
): Promise<CreativeMonotonyEvaluation> {
  const entries = await readCreativeQualityLedger(root, windowSize);
  const streaks = detectCreativeStreaks(entries);
  const tombstonePath = creativeMonotonyTombstonePath(root);

  if (streaks.length === 0) {
    // Streak broken (or never started): clear any tombstone so the next
    // occurrence is treated as a fresh incident.
    await rm(tombstonePath, { force: true }).catch(() => undefined);
    return { streaks, notified: false };
  }

  const signature = creativeStreakSignature(streaks);
  const existing = await readMonotonyTombstone(root);
  if (existing?.signature === signature) {
    return { streaks, notified: false };
  }

  const detail = describeCreativeStreaks(streaks);
  emitRuntimeEvent({
    type: "creative_monotony_warning",
    streaks,
    signature,
    detail,
    songId: entries[0]?.songId,
    timestamp: Date.now()
  });

  await mkdir(dirname(tombstonePath), { recursive: true });
  await writeFile(
    tombstonePath,
    `${JSON.stringify({ signature, detail, notifiedAt: new Date().toISOString() } satisfies CreativeMonotonyTombstone)}\n`,
    "utf8"
  );
  return { streaks, notified: true };
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
    if (entry.decision) {
      // Annotate the decision with the material and catchphrases that actually
      // landed in this song's lyrics so the director can keep the next song off
      // recently-used material and ban the previous song's catchphrases.
      // Conditional spread avoids creating own `undefined` annotation fields.
      decisions.push(
        entry.usedMaterial || entry.usedCatchphrases
          ? {
              ...entry.decision,
              ...(entry.usedMaterial ? { usedMaterial: entry.usedMaterial } : {}),
              ...(entry.usedCatchphrases ? { usedCatchphrases: entry.usedCatchphrases } : {})
            }
          : entry.decision
      );
    }
    if (decisions.length >= limit) break;
  }
  return decisions.reverse();
}

// Kanji (incl. 々), katakana (incl. ー). Hiragana particles break runs so key
// terms stay on distinctive content words.
const KEY_TERM_PATTERN = /[一-鿿々゠-ヿ]{2,}/g;

// Parse the noun phrases of the "### Shibuya Diss Material Bank" bullet items.
// Returns [] when the section is absent (older workspaces must not break). The
// heading is matched tolerantly (trim/case/full-width/whitespace) via the shared
// personaHeadings contract so a hand edit to the canon heading cannot silently
// zero out diss-bank telemetry.
export function extractDissBankItems(artistMd: string): string[] {
  const lines = artistMd.split(/\r?\n/);
  const start = lines.findIndex((line) => headingMatches(line, SHIBUYA_DISS_MATERIAL_BANK_HEADING));
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

// Which of `phrases` actually landed in `lyrics`. Uses the same AI-free
// inclusion approximation as computeDissBankHits: a phrase counts as used when
// the whole phrase appears verbatim OR any of its 2+-char key terms
// (kanji/katakana runs) appears — the AI is told to weave the noun phrases in,
// not transcribe them, so a term-level match avoids silently recording nothing.
// Deterministic; input order preserved.
export function materialPhrasesUsed(phrases: readonly string[], lyrics: string): string[] {
  const used: string[] = [];
  for (const phrase of phrases) {
    if (!phrase) continue;
    if (lyrics.includes(phrase)) {
      used.push(phrase);
      continue;
    }
    const terms = keyTermsForItem(phrase);
    if (terms.length > 0 && terms.some((term) => lyrics.includes(term))) {
      used.push(phrase);
    }
  }
  return used;
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
