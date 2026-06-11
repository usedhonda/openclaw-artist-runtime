import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, CascadeTraceSource, CommissionBrief, CommissionBriefSource, ObservationSummary, SongSpawnProposal, SongState } from "../types.js";
import { callAiProvider, isAiNotConfiguredResponse } from "./aiProviderClient.js";
import { composeArtistFallback } from "./artistVoiceComposer.js";
import { listSongStates } from "./artistState.js";
import { readCallbackActionEntries } from "./callbackActionRegistry.js";
import { extractPersonaMotifs, extractTagSet, pickWeightedMotif } from "./personaMotifExtractor.js";
import { secretLikePattern } from "./personaMigrator.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { readBudgetState } from "./sunoBudgetLedger.js";
import { validateAgainstVoiceContract } from "./voiceContractValidator.js";
import { isVoiceFingerprintReady, parseVoiceFingerprint, type VoiceFingerprintBundle } from "./voiceFingerprintParser.js";
import { readObservationsReport } from "./xObservationCollector.js";
import { readTodayNewsObservations } from "./newsObservationCollector.js";

const FULL_TWEET_URL_PATTERN = /^https:\/\/(?:twitter|x)\.com\/[^/\s]+\/status\/\d+/i;

export interface ProposeSpawnOptions {
  aiReviewProvider?: AiReviewProvider;
  now?: Date;
  activeQueueContext?: ActiveQueueContextEntry[];
  ignoreRecentCompletion?: boolean;
}

export interface ActiveQueueContextEntry {
  title: string;
  coreTheme: string;
  observationSources?: CascadeTraceSource[];
  motifRank?: number;
}

function assertSafe(stage: string, value: string): void {
  if (secretLikePattern.test(value)) {
    throw new Error(`song_spawn_secret_like_${stage}`);
  }
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

interface ObservationExcerpt {
  text: string;
  author?: string;
  url?: string;
  sourceKind: "x" | "news";
  motifMatch?: string;
  motifScore?: number;
}

interface LatestObservationData {
  raw: string;
  summary?: ObservationSummary;
  excerpts?: ObservationExcerpt[];
}

async function latestObservationData(root: string): Promise<LatestObservationData> {
  const dir = join(root, "observations");
  const entries = await readdir(dir).catch(() => []);
  // Plan v10.38 Phase B: walk X observation files in date order; the newest
  // X-only cache still seeds the `raw` blob that feeds prompts and brief
  // generation. News entries are merged into the scored pool below so the
  // top-scoring entry can come from a news source even when X is thin.
  const xFiles = entries
    .filter((entry) => entry.endsWith(".md") && !entry.startsWith("news-"))
    .sort();
  const latest = xFiles.at(-1);
  let raw = "";
  let xReportEntries: { text: string; author?: string; url?: string; postedAt?: string; motifMatch?: string; motifScore?: number }[] = [];
  if (latest) {
    raw = await readFile(join(dir, latest), "utf8").catch(() => "");
    const dateStr = latest.replace(/\.md$/, "");
    const report = await readObservationsReport(root, dateStr).catch(() => null);
    xReportEntries = report?.entries ?? [];
  }
  // Plan v10.38 Phase B: merge today's news cache entries into the same
  // scoring pool. News entries have URLs (RSS link) and source label; they
  // lack X authors so they bypass the @user requirement that filters X-only.
  const newsEntries = await readTodayNewsObservations(root).catch(() => []);
  const newsAsObservation = newsEntries.map((entry) => ({
    text: entry.text,
    author: entry.source,
    url: entry.url,
    postedAt: entry.postedAt,
    motifMatch: entry.motifMatch,
    motifScore: entry.motifScore,
    sourceKind: "news" as const
  }));
  const xAsObservation = xReportEntries.map((entry) => ({
    ...entry,
    sourceKind: "x" as const
  }));
  const pool = [...xAsObservation, ...newsAsObservation];
  if (pool.length === 0 && !raw) return { raw: "" };
  // Stitch the news block onto raw so prompt builders that read raw text see
  // both streams even before E adds explicit excerpt sections.
  const newsRaw = newsEntries
    .slice(0, 12)
    .map((entry) => `- ${entry.text}${entry.source ? ` [${entry.source}]` : ""}${entry.url ? ` ${entry.url}` : ""}`)
    .join("\n");
  if (newsRaw) {
    raw = raw ? `${raw.trim()}\n\n# News Excerpts\n${newsRaw}\n` : `# News Excerpts\n${newsRaw}\n`;
  }
  const sorted = [...pool].sort((a, b) => (b.motifScore ?? 0) - (a.motifScore ?? 0));
  // Plan v10.38 Phase E: keep top-N excerpts so buildPrompt can show them to
  // the AI as "Today's Topic (main material)". Both X and news entries pass
  // through here, scored by the same persona motif rubric.
  const excerpts: ObservationExcerpt[] = sorted.slice(0, 10).map((entry) => ({
    text: entry.text,
    author: entry.author,
    url: entry.url,
    sourceKind: entry.sourceKind,
    motifMatch: entry.motifMatch,
    motifScore: entry.motifScore
  }));
  for (const entry of sorted) {
    const quote = (entry.text ?? "").trim();
    if (!quote) continue;
    if (secretLikePattern.test(quote)) continue;
    if (entry.sourceKind === "x") {
      if (!entry.url || !FULL_TWEET_URL_PATTERN.test(entry.url)) continue;
      if (!entry.author || entry.author === "_") continue;
      return {
        raw,
        summary: {
          quote: quote.slice(0, 240),
          author: entry.author,
          url: entry.url
        },
        excerpts
      };
    }
    // news entry: accept https url and source label as author.
    if (!entry.url || !/^https?:\/\//i.test(entry.url)) continue;
    return {
      raw,
      summary: {
        quote: quote.slice(0, 240),
        author: entry.author ?? "news",
        url: entry.url
      },
      excerpts
    };
  }
  return { raw, excerpts };
}

function hasRestMood(heartbeat: string, soulMd: string): boolean {
  return /(?:\brest\b|\bpause\b|\bsleep\b|休|静養|停止|休む)/i.test(`${heartbeat}\n${soulMd}`);
}

function recentCompletedTooClose(songs: SongState[], now: Date): boolean {
  const latest = songs.find((song) => ["published", "scheduled", "take_selected"].includes(song.status));
  if (!latest) {
    return false;
  }
  return now.getTime() - new Date(latest.updatedAt).getTime() < 6 * 60 * 60 * 1000;
}

function normalizeTheme(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9一-龠ぁ-んァ-ヶー]+/gi, "");
}

// Plan v10.38 Phase C: recent spawn surface for dedup. Carry title +
// lyricsTheme + brief so isSimilarTheme can do motif-level jaccard, not just
// title substring match. Previously the dedup tripped only when a new title
// literally contained an old title (or vice versa); semantic dupes ("六本木の
// 社会風刺" vs "六本木で経営者を切る") slipped through.
interface RecentSpawnTheme {
  title: string;
  lyricsTheme?: string;
  brief?: string;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isSimilarTheme(
  candidate: { title?: string; lyricsTheme?: string; brief?: string },
  recentThemes: RecentSpawnTheme[]
): boolean {
  const candidateText = [candidate.title, candidate.lyricsTheme, candidate.brief].filter(Boolean).join("\n");
  const candidateTags = extractTagSet(candidateText);
  const candidateTitle = candidate.title?.trim() ?? "";
  const normalizedCandidate = normalizeTheme(candidateTitle);
  for (const recent of recentThemes) {
    const recentTitle = recent.title?.trim() ?? "";
    if (recentTitle && candidateTitle) {
      const normalizedRecent = normalizeTheme(recentTitle);
      if (normalizedRecent.length >= 3 && normalizedCandidate.length >= 3) {
        if (normalizedRecent === normalizedCandidate) return true;
        // Safety net: substring match retains pre-v10.38 dedup for titles that
        // truncate or extend each other (e.g. a 32-char slice of an earlier
        // title). The jaccard layer below catches the semantic-rephrase case
        // the substring path always missed.
        if (normalizedRecent.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedRecent)) return true;
      }
    }
    if (candidateTags.size === 0) continue;
    const recentText = [recent.title, recent.lyricsTheme, recent.brief].filter(Boolean).join("\n");
    const recentTags = extractTagSet(recentText);
    if (recentTags.size === 0) continue;
    if (jaccardSimilarity(candidateTags, recentTags) >= 0.5) return true;
  }
  return false;
}

function queueContextAsRecentThemes(entries: ActiveQueueContextEntry[] = []): RecentSpawnTheme[] {
  return entries.map((entry) => ({
    title: entry.title,
    lyricsTheme: entry.coreTheme,
    brief: entry.observationSources?.map((source) => source.quote).filter(Boolean).join("\n")
  }));
}

async function recentSpawnThemes(root: string, now: Date): Promise<RecentSpawnTheme[]> {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  const entries = await readCallbackActionEntries(root).catch(() => []);
  const seen = new Map<string, RecentSpawnTheme>();
  for (const entry of entries) {
    if (entry.createdAt < cutoff || !entry.commissionBrief?.title || !entry.action.startsWith("song_spawn_")) {
      continue;
    }
    const title = entry.commissionBrief.title;
    if (seen.has(title)) continue;
    seen.set(title, {
      title,
      lyricsTheme: entry.commissionBrief.lyricsTheme,
      brief: entry.commissionBrief.brief
    });
  }
  return Array.from(seen.values()).slice(-12);
}

function titleFromSeed(
  seed: string,
  motifs?: ReturnType<typeof extractPersonaMotifs>,
  observationTopTags: string[] = [],
  rng?: () => number
): string {
  // Plan v10.38 Phase C: pickWeightedMotif replaces [0]-pinning on themes /
  // geographies so the title bucket rotates across the ARTIST.md seed instead
  // of locking onto 社会風刺 + 六本木 every cycle. Observation top tags bias
  // the pick toward what X / news is saying today when available. Title text
  // is shown to the producer + lands in the Japanese reason line, so we keep
  // the pick japanese-only here too -- english motifs (hip-hop / Brooklyn) are
  // available to AI prompts via the raw motif bundle, but should not surface
  // as the song title.
  if (motifs) {
    const themeWord = firstJapanesePhrase(motifs.themes, "", observationTopTags, rng);
    const geoWord = firstJapanesePhrase(motifs.geographies, "", observationTopTags, rng);
    if (themeWord && geoWord) return `${geoWord}の${themeWord}`.slice(0, 32);
    if (themeWord) return themeWord.slice(0, 32);
  }
  const lines = seed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const skipPrefixes = [/^#\s*X Observations/i, /^Query:/i, /^Motifs:/i, /^Source:/i, /^- text:/i, /^- author:/i, /^- url:/i, /^- postedAt:/i, /^author:/i, /^url:/i, /^postedAt:/i, /^motifMatch:/i, /^motifScore:/i];
  const meaningful = lines.find((line) => {
    const stripped = line.replace(/^#+\s*/, "");
    if (!stripped) return false;
    return !skipPrefixes.some((re) => re.test(line));
  });
  if (meaningful) {
    const cleaned = meaningful
      .replace(/^- text:\s*/i, "")
      .replace(/^["「『]+|["」』]+$/g, "")
      .replace(/^#+\s*/, "")
      .slice(0, 24);
    if (cleaned) return cleaned;
  }
  return "静かな夜の勘定書";
}

type PitchField = "lyricsTheme" | "styleNotes" | "reason";

interface PitchDensityContext {
  observation: string;
  artistMd: string;
  soulMd: string;
  fingerprint: VoiceFingerprintBundle;
}

const honestThinMarkerPattern = /まだ|言葉になってない|輪郭しか|仮で|これから/;
const fillerPattern = /(.{6,})\1{2,}|いい感じ|うまく/;
const machineVoicePattern = /(?:ARTIST\.md|SOUL\.md|INNER\.md|PRODUCER\.md|IDENTITY\.md|themes:|geo:|vocab:|sound:|motif anchor:|\bparse\b|\bbuild\b|\bfield\b|\bconfig\b|\bruntime\b|\bmock\b)|TBD|未定|未記入|todo|fixme|none|n\/a|基礎人格|基礎トーン|に基づき|を変換|を生成/i;

function charLength(value: string): number {
  return Array.from(value).length;
}

function firstLine(value: string, fallback: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^-\s*(?:text|quote):\s*/i, "").replace(/^["']|["']$/g, "") ?? fallback;
}

function firstPhrase(
  values: string[],
  fallback: string,
  observationTopTags: string[] = [],
  rng?: () => number
): string {
  // Plan v10.38 Phase C: route motif bucket through pickWeightedMotif so the
  // first ARTIST.md seed no longer pins title / pitch slots. fallback is used
  // only when the bucket is empty.
  const filtered = values.filter((value) => value.trim().length > 0);
  if (filtered.length === 0) return fallback;
  const picked = pickWeightedMotif(filtered, observationTopTags, rng);
  return picked?.split(/[/|,、]/)[0]?.trim() || fallback;
}

function hasOnlyNonAsciiCharacters(value: string): boolean {
  return Array.from(value).every((character) => (character.codePointAt(0) ?? 0) > 0x7f);
}

// Plan v10.38 Phase C: japanese-only weighted phrase picker. Used by pitchSlots
// for sound and place fields that feed the artist-voice reason line — without
// the filter, the weighted pick can surface "hip-hop" / "Brooklyn" / "Rhodes"
// from the ARTIST.md seed list and inject English tokens into a Japanese-only
// reason. Keeps motif rotation alive but guards the voice contract.
function firstJapanesePhrase(
  values: string[],
  fallback: string,
  observationTopTags: string[] = [],
  rng?: () => number
): string {
  const filtered = values.filter((value) => value.trim().length > 0 && hasOnlyNonAsciiCharacters(value.trim()));
  if (filtered.length === 0) return fallback;
  const picked = pickWeightedMotif(filtered, observationTopTags, rng);
  return picked?.split(/[/|,、]/)[0]?.trim() || fallback;
}

function hasCoreTheme(motifs: ReturnType<typeof extractPersonaMotifs>): boolean {
  return motifs.themes.length + motifs.vocabulary.length + motifs.geographies.length + motifs.sound.length > 0;
}

function isThinPitchContext(context: PitchDensityContext): boolean {
  const motifs = extractPersonaMotifs([context.artistMd, context.soulMd].join("\n"));
  return context.observation.trim().length < 40 || !hasCoreTheme(motifs) || !isVoiceFingerprintReady(context.fingerprint).ok;
}

function pitchSlots(context: PitchDensityContext): { theme: string; place: string; object: string; sound: string; callname: string; observation: string } {
  const motifs = extractPersonaMotifs([context.artistMd, context.soulMd].join("\n"));
  return {
    theme: firstPhrase(motifs.themes, firstPhrase(motifs.vocabulary, "街の違和感")),
    // Plan v10.38 Phase C: place and sound feed the Japanese-only reason line,
    // so filter to japanese motifs to keep "Brooklyn" / "hip-hop" out of voice.
    place: firstJapanesePhrase(motifs.geographies, "街"),
    object: firstPhrase(motifs.vocabulary, firstPhrase(motifs.themes, "ざらつき")),
    sound: firstJapanesePhrase(motifs.sound, "低いベース"),
    callname: context.fingerprint.producerCallname ?? "ゆずるさん",
    observation: firstLine(context.observation, "観察の切れ端")
  };
}

function fallbackPitchLine(field: PitchField, context: PitchDensityContext, thin = isThinPitchContext(context)): string {
  const slots = pitchSlots(context);
  if (thin) {
    if (field === "lyricsTheme") return `まだ言葉になってない。${slots.object}の輪郭だけ、仮で短いフックに捕まえる。`;
    if (field === "styleNotes") return `まだ輪郭しかない。仮で sparse arrangement, low bass だけ置く。`;
    return `${slots.callname}、まだ輪郭しかない。${slots.theme}だけ仮で捕まえて、これから詰めるな。`;
  }
  if (field === "lyricsTheme") {
    return `${slots.theme}を${slots.place}の手触りで切る。サビは短く繰り返したくなる 1 行、ヴァースで景色を出して${slots.object}を最後に置く。言い切らずに残る違和感を、短いフックへ畳んで、最後の余白で刺す。`;
  }
  if (field === "styleNotes") {
    return `${slots.sound} frame, thick bass on low register, restrained hi-hats, vocals nestled between instruments, sparse arrangement, breathing space, unsentimental dry vocals.`;
  }
  return `${slots.callname}、${slots.place}で見た${slots.object}がずっと残ってる。${slots.theme}として切る、捨てずに持ってた違和感をそのまま置いて、低い音と短いフックに委ねたい。怖さは残るけど、逃がさないな。`;
}

function validPitchField(value: string, thin: boolean): boolean {
  const length = charLength(value);
  const min = thin ? 30 : 80;
  const max = thin ? 60 : 220;
  return length >= min && length <= max && (!thin || honestThinMarkerPattern.test(value));
}

function normalizePitchField(field: PitchField, value: string | undefined, context: PitchDensityContext): string {
  const thin = isThinPitchContext(context);
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (
    !clean ||
    secretLikePattern.test(clean) ||
    machineVoicePattern.test(clean) ||
    fillerPattern.test(clean) ||
    !validPitchField(clean, thin)
  ) {
    return fallbackPitchLine(field, context, thin);
  }
  return clean;
}

export function dedupeStyleBpm(styleNotes: string, tempo: string): string {
  const tempoBpm = tempo.match(/\b\d{2,3}\s*BPM\b/i)?.[0];
  if (tempoBpm) {
    return styleNotes
      .replace(/(?:^|[、,・\s])(?:BPM:\s*\d{2,3}|\d{2,3}\s*BPM)\b/gi, "")
      .replace(/\s*([、,・])\s*\1+/g, "$1")
      .replace(/^[、,・\s]+|[、,・\s]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim() || styleNotes;
  }
  let seen = false;
  return styleNotes
    .replace(/(?:BPM:\s*\d{2,3}|\d{2,3}\s*BPM)\b/gi, (match) => {
      if (seen) return "";
      seen = true;
      return match.replace(/^BPM:\s*/i, "");
    })
    .replace(/\s*([、,・])\s*\1+/g, "$1")
    .replace(/^[、,・\s]+|[、,・\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildBrief(context: { observation: string; artistMd: string; soulMd: string; fingerprint: VoiceFingerprintBundle; budgetRemaining: number; now: Date; observationTopTags?: string[]; rng?: () => number }): CommissionBrief {
  const seed = context.observation || context.soulMd || "観察が薄い夜に、街の温度だけ残っている。";
  const titleMotifs = extractPersonaMotifs([context.artistMd, context.soulMd].join("\n"));
  const observationTopTags = context.observationTopTags ?? [];
  const title = titleFromSeed(seed, titleMotifs, observationTopTags, context.rng);
  // Plan v10.38 Phase C: weighted motif pick replaces [0] fixation, japanese
  // only because these tokens feed the producer-facing brief sentence below.
  const themeWord = firstJapanesePhrase(titleMotifs.themes, "", observationTopTags, context.rng);
  const placeWord = firstJapanesePhrase(titleMotifs.geographies, "", observationTopTags, context.rng);
  const objectWord = firstJapanesePhrase(titleMotifs.vocabulary, "", observationTopTags, context.rng);
  const briefSentence = themeWord && placeWord
    ? `${placeWord}で見た${objectWord || "違和感"}を、${themeWord}として切る一曲`
    : themeWord
      ? `${themeWord}を音にする一曲`
      : seed.slice(0, 280);
  const songId = `spawn_${shortHash(`${seed}:${context.now.toISOString()}`)}`;
  const densityContext = {
    observation: context.observation,
    artistMd: context.artistMd,
    soulMd: context.soulMd,
    fingerprint: context.fingerprint
  };
  return {
    songId,
    title,
    brief: briefSentence,
    lyricsTheme: normalizePitchField("lyricsTheme", undefined, densityContext),
    mood: "observational, slight sarcasm, late-night urban pressure",
    tempo: "artist decides",
    styleNotes: normalizePitchField("styleNotes", undefined, densityContext),
    duration: "artist decides",
    sourceText: "autopilot song spawn",
    createdAt: context.now.toISOString()
  };
}

function buildVoiceContractLines(fingerprint: VoiceFingerprintBundle): string[] {
  const lines: string[] = ["Voice Contract for the `reason` field (highest priority — match this voice or the line will be replaced):"];
  if (fingerprint.producerCallname) {
    lines.push(`- Address producer as "${fingerprint.producerCallname}".`);
  }
  if (fingerprint.firstPerson) {
    lines.push(`- First-person: "${fingerprint.firstPerson}".`);
  }
  if (fingerprint.sentenceEndings.length > 0) {
    lines.push(`- Allowed sentence endings: ${fingerprint.sentenceEndings.slice(0, 6).map((e) => `"${e}"`).join(" / ")}.`);
  }
  if (fingerprint.forbiddenPhrases.length > 0) {
    const sample = fingerprint.forbiddenPhrases.slice(0, 6).map((p) => `"${p}"`).join(", ");
    lines.push(`- Forbidden phrases (NEVER output): ${sample}.`);
  }
  if (fingerprint.signatureMoves.length > 0) {
    lines.push("- Sample voice (the ONLY way to sound):");
    for (const sample of fingerprint.signatureMoves.slice(0, 4)) {
      lines.push(`  · "${sample}"`);
    }
  }
  return lines;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3)}...`;
}

function buildPersonaBody(context: { artistMd: string; soulMd: string; identityMd: string; innerMd: string; producerMd: string }): string[] {
  const sections: { name: string; content: string; cap: number }[] = [
    { name: "SOUL.md", content: context.soulMd, cap: 12000 },
    { name: "ARTIST.md", content: context.artistMd, cap: 6000 },
    { name: "IDENTITY.md", content: context.identityMd, cap: 1500 },
    { name: "INNER.md", content: context.innerMd, cap: 4000 },
    { name: "PRODUCER.md", content: context.producerMd, cap: 3000 }
  ];
  const out: string[] = [];
  for (const section of sections) {
    if (!section.content || section.content.trim().length === 0) continue;
    out.push(`===== ${section.name} =====`);
    out.push(truncate(section.content, section.cap));
    out.push("");
  }
  return out;
}

// Plan v10.38 Phase E: structured topic excerpts feed the AI alongside the
// raw observation blob. The AI now sees today's news + X voice as a bullet
// list of "main material", separate from the persona body that acts as the
// 60% color lens. Without this section the AI got only ARTIST.md and a raw
// text dump, and the spawn pipeline collapsed onto the persona seeds even
// when the observation pool carried genuinely new material.
function buildTopicSection(excerpts?: ObservationExcerpt[]): string[] {
  if (!excerpts || excerpts.length === 0) {
    return [
      "## Today's Topic (news + X voice — MAIN MATERIAL, 40% weight):",
      "(観察 pool が空)"
    ];
  }
  const lines = [
    "## Today's Topic (news + X voice — MAIN MATERIAL, 40% weight):",
    "観察を主素材として歌詞に取り込む。 ARTIST.md は色付けの lens にする。"
  ];
  for (const entry of excerpts) {
    const author = entry.author
      ? entry.sourceKind === "news"
        ? `[news:${entry.author}]`
        : `[@${entry.author.replace(/^@/, "")}]`
      : `[${entry.sourceKind}]`;
    const url = entry.url ? ` (${entry.url})` : "";
    const match = entry.motifMatch ? ` motif:${entry.motifMatch}` : "";
    lines.push(`- ${entry.text.slice(0, 220)} ${author}${url}${match}`);
  }
  return lines;
}

function buildObservationCascadeSection(excerpts: ObservationExcerpt[] | undefined, seed: string): string[] {
  if (!excerpts || excerpts.length === 0) {
    return [
      "## Observation Cascade (voiceTop / pitch shared single source):",
      `seed: ${seed}`,
      "trigger: none"
    ];
  }
  const lines = [
    "## Observation Cascade (voiceTop / pitch shared single source):",
    `seed: ${seed}`,
    "この block と Telegram voiceTop は同じ観察 cache から来る。trigger -> motif rank -> pitch の順で使う。"
  ];
  excerpts.slice(0, 5).forEach((entry, index) => {
    const role = index === 0 ? "trigger" : `secondary-${index}`;
    const rank = typeof entry.motifScore === "number" ? entry.motifScore : 0;
    const motif = entry.motifMatch ?? "no motif match";
    const source = entry.author ? `${entry.sourceKind}:${entry.author}` : entry.sourceKind;
    lines.push(`${role}: kind=${entry.sourceKind} source=${source} motifRank=${rank} motif=${motif} quote=${entry.text.slice(0, 140)}`);
  });
  return lines;
}

function buildActiveQueueContextSection(entries: ActiveQueueContextEntry[] = []): string[] {
  const lines = ["## Already proposed (do not duplicate angle)"];
  if (entries.length === 0) {
    lines.push("- none");
    return lines;
  }
  for (const entry of entries.slice(0, 5)) {
    const source = entry.observationSources?.[0];
    const sourceText = source?.quote ? ` source=${source.quote.slice(0, 80)}` : "";
    const rankText = typeof entry.motifRank === "number" ? ` motifRank=${entry.motifRank}` : "";
    lines.push(`- ${entry.title}: ${entry.coreTheme}${rankText}${sourceText}`);
  }
  return lines;
}

function buildPrompt(context: {
  artistMd: string;
  soulMd: string;
  identityMd: string;
  innerMd: string;
  producerMd: string;
  observation: string;
  heartbeat: string;
  recentSongs: SongState[];
  budgetRemaining: number;
  recentThemes: RecentSpawnTheme[];
  fingerprint: VoiceFingerprintBundle;
  observationExcerpts?: ObservationExcerpt[];
  cascadeSeed: string;
  activeQueueContext?: ActiveQueueContextEntry[];
}): string {
  const lines: string[] = [
    "System: あなたは used::honda 本人。 producer に新曲を提案する artist として一人称で書く。",
    "Decision: 観察と heartbeat から、 今 新曲を始めるべきか判断する。 不十分なら spawn: no。",
    // Plan v10.38 Phase E: explicit material policy. Observation is the trigger
    // and main material (e.g. today's LUUP incident + the X reaction around it),
    // ARTIST.md is the lens that colors the take (六本木 / 経営者 / hip-hop). The
    // ratio is ~40% observation main / 60% persona lens.
    "Material policy: 観察 (news + X) を主素材、 ARTIST.md / SOUL.md は色付けの lens として使う。 例: news で『LUUP 事故』 が出ていれば、 X 上の LUUP 反応を歌詞に取り込み、 ARTIST.md の六本木の経営者目線で切る。 lens を起点にして同じ motif を毎回繰り返さない。",
    "Avoid any subject or title already listed in recently proposed themes.",
    "Never include secrets. Keep the brief lean enough for autopilot planning.",
    "",
    // Plan v10.38 Phase F hallucination guard: the AI MUST list the
    // observation entries it actually used. Each line carries kind, URL,
    // optional author/source. brief / lyricsTheme that reference news or
    // X without listing the source here are treated as fabricated.
    "出力 schema (1 行ずつ、 順序固定):",
    "spawn: <yes/no>",
    "title: <artistic title> (漢字 / カタカナ / 平仮名は元表記のまま。 タイトルだけは hiragana 化しない。 hiragana 化は歌詞 Suno 誤読対策に限る)",
    "brief: <280 chars 以内、 楽曲の中身要約>",
    "lyricsTheme: <2-4 文、 日本語、 sub 構造込み。最低 2 文。例: \"六本木で見た経営者を社会風刺として切る。サビは短く 1 行のリフレインだけ、ヴァースで景色を出してサビでそれを 1 行に畳む。\">",
    "mood: <english spec keywords e.g. 'tense, late-night, urban pressure'>",
    "tempo: <'artist decides' or '142 BPM'>",
    "duration: <'2:45' 等>",
    "style: <english spec keywords + instrumentation roles. 最低 3 要素。例: \"thick bass on low register, restrained hi-hats, vocals nestled between instruments, sparse arrangement, breathing space\">",
    "reason: <**日本語のみ**、 artist 一人称口語、 producer に話しかける 1 行 (e.g. \"" + (context.fingerprint.producerCallname ?? "ゆずる") + "、 〜の街を切るやつ、 刺さる\")>",
    "sources: <Today's Topic から実際に使った観察 entry を最低 1 件、 最大 5 件、 改行区切りで列挙。 各行は `- kind:<x|news> url:<https://...> author:<@user or source label> quote:<本文を 60 字以内で抜粋>` の形式。 use していない entry は書かない、 捏造禁止>",
    "",
    ...buildVoiceContractLines(context.fingerprint),
    "",
    `Budget remaining: ${context.budgetRemaining}`,
    `Recent songs: ${context.recentSongs.slice(0, 5).map((song) => `${song.songId}:${song.status}:${song.title}`).join(" | ")}`,
    `Recently proposed themes to avoid: ${context.recentThemes.length > 0 ? context.recentThemes.map((t) => t.title).join(" | ") : "none"}`,
    "",
    ...buildActiveQueueContextSection(context.activeQueueContext),
    "",
    ...buildTopicSection(context.observationExcerpts),
    "",
    ...buildObservationCascadeSection(context.observationExcerpts, context.cascadeSeed),
    "",
    "Raw observation excerpts (context only):",
    context.observation.slice(0, 1200),
    "",
    "Heartbeat:",
    context.heartbeat.slice(0, 500),
    "",
    "## Artist Lens (ARTIST.md / SOUL.md persona — 60% color):",
    "下記の persona block は歌詞の起点ではない。 観察に色を付ける lens として使い、 主題は Today's Topic から取る。",
    "",
    ...buildPersonaBody(context)
  ];
  return lines.join("\n");
}

function parseDirective(raw: string, key: string): string | undefined {
  const line = raw.split(/\r?\n/).find((candidate) => candidate.toLowerCase().startsWith(`${key.toLowerCase()}:`));
  return line?.slice(line.indexOf(":") + 1).trim();
}

function briefFromAi(raw: string, fallback: CommissionBrief, now: Date, context: PitchDensityContext): { brief: CommissionBrief; reason: string; spawn: boolean } {
  const spawnValue = parseDirective(raw, "spawn")?.toLowerCase();
  const spawn = !spawnValue || /^(yes|true|1|go|進める|作る)/i.test(spawnValue);
  const title = parseDirective(raw, "title") || fallback.title;
  const brief = parseDirective(raw, "brief") || fallback.brief;
  const sources = parseSourcesFromAi(raw);
  const tempo = parseDirective(raw, "tempo") || fallback.tempo;
  const styleNotes = dedupeStyleBpm(normalizePitchField("styleNotes", parseDirective(raw, "style"), context), tempo);
  return {
    spawn,
    reason: normalizePitchField("reason", parseDirective(raw, "reason"), context),
    brief: {
      ...fallback,
      title,
      brief,
      lyricsTheme: normalizePitchField("lyricsTheme", parseDirective(raw, "lyricsTheme") || parseDirective(raw, "lyrics"), context),
      mood: parseDirective(raw, "mood") || fallback.mood,
      tempo,
      duration: parseDirective(raw, "duration") || fallback.duration,
      styleNotes,
      createdAt: now.toISOString(),
      sources: sources.length > 0 ? sources : fallback.sources
    }
  };
}

// Plan v10.38 Phase F hallucination guard parser. Reads any line starting with
// "- kind:<x|news>" anywhere under a `sources:` block in the AI response and
// pulls url / author / quote. URLs must match http(s); anything else is
// rejected so the model can't smuggle in fake citations.
function parseSourcesFromAi(raw: string): CommissionBriefSource[] {
  const sources: CommissionBriefSource[] = [];
  const lines = raw.split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^sources:/i.test(trimmed)) {
      inBlock = true;
      const inline = trimmed.replace(/^sources:\s*/i, "").trim();
      if (inline && inline.startsWith("-")) {
        const parsed = parseSourceLine(inline);
        if (parsed) sources.push(parsed);
      }
      continue;
    }
    if (!inBlock) continue;
    if (/^[a-z]+:/i.test(trimmed) && !trimmed.startsWith("-")) {
      // moved into a different schema field
      inBlock = false;
      continue;
    }
    if (trimmed.startsWith("-")) {
      const parsed = parseSourceLine(trimmed);
      if (parsed) sources.push(parsed);
    }
  }
  return sources.slice(0, 5);
}

function parseSourceLine(line: string): CommissionBriefSource | undefined {
  const body = line.replace(/^-\s*/, "").trim();
  const kindMatch = body.match(/kind:\s*(x|news)/i);
  const urlMatch = body.match(/url:\s*(https?:\/\/\S+)/i);
  if (!kindMatch || !urlMatch) return undefined;
  const authorMatch = body.match(/author:\s*("[^"]+"|\S+)/i);
  const quoteMatch = body.match(/quote:\s*("([^"]+)"|(.+?))(?=\s+(?:kind|url|author):|$)/i);
  return {
    kind: kindMatch[1].toLowerCase() as "x" | "news",
    url: urlMatch[1].trim(),
    author: authorMatch?.[1]?.replace(/^["']|["']$/g, "").trim() || undefined,
    quote: (quoteMatch?.[2] ?? quoteMatch?.[3])?.trim().slice(0, 200) || undefined
  };
}

// Plan v10.38 Phase F: when the AI is mock / not_configured we still need to
// stamp the brief with the excerpts it used so producer can audit the chain.
function sourcesFromExcerpts(excerpts: ObservationExcerpt[]): CommissionBriefSource[] {
  return excerpts
    .filter((entry) => entry.url && /^https?:\/\//i.test(entry.url))
    .slice(0, 3)
    .map((entry) => ({
      kind: entry.sourceKind,
      url: entry.url as string,
      author: entry.author,
      quote: entry.text.slice(0, 200)
    }));
}

function composeReasonInArtistVoice(args: {
  artistMd: string;
  soulMd: string;
  fingerprint: VoiceFingerprintBundle;
  observation: string;
  brief?: CommissionBrief;
}): string {
  const context = {
    observation: args.observation,
    artistMd: args.artistMd,
    soulMd: args.soulMd,
    fingerprint: args.fingerprint
  };
  if (args.brief) {
    const briefAnchored = composeReasonFromBrief(args.brief, args.fingerprint, context);
    if (briefAnchored) return briefAnchored;
  }
  const composed = composeArtistFallback({
    userMessage: args.observation.slice(0, 200),
    motifs: extractPersonaMotifs([args.artistMd, args.soulMd].join("\n")),
    userIntent: "propose",
    voiceFingerprint: args.fingerprint,
    lastEndings: []
  });
  return normalizePitchField("reason", composed, context);
}

function firstJapaneseSound(context: PitchDensityContext, fallback: string): string {
  const motifs = extractPersonaMotifs([context.artistMd, context.soulMd].join("\n"));
  const found = motifs.sound.find((s) => hasOnlyNonAsciiCharacters(s.trim()));
  return found?.split(/[/|,、]/)[0]?.trim() || fallback;
}

function composeReasonFromBrief(
  brief: CommissionBrief,
  fingerprint: VoiceFingerprintBundle,
  context: PitchDensityContext
): string | undefined {
  const callname = fingerprint.producerCallname ?? "ゆずるさん";
  const title = brief.title?.trim();
  const briefSummary = (brief.brief ?? "").replace(/[。.]+\s*$/u, "").trim().slice(0, 90);
  if (!title || !briefSummary) return undefined;
  const sound = firstJapaneseSound(context, "低い音");
  const candidates = [
    `${callname}、 「${title}」 を書きたいんだ。 ${briefSummary}、 これを${sound}と短いフックに委ねたい。 怖さは残るけど、 逃がさないな。`,
    `${callname}、 「${title}」 で 1 曲、 やらせてくれ。 ${briefSummary}、 そのまま置いて言い切らずに残す。 ${sound}と余白で刺すな。`
  ];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/\s+/g, " ").trim();
    if (charLength(cleaned) < 80 || charLength(cleaned) > 220) continue;
    if (secretLikePattern.test(cleaned)) continue;
    if (machineVoicePattern.test(cleaned)) continue;
    if (fillerPattern.test(cleaned)) continue;
    return cleaned;
  }
  return undefined;
}

export async function proposeSpawn(root: string, options: ProposeSpawnOptions = {}): Promise<SongSpawnProposal | null> {
  const now = options.now ?? new Date();
  const [artistMd, soulMd, identityMd, innerMd, producerMd, heartbeat, obsData, songs, budget, recentThemes] = await Promise.all([
    readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
    readFile(join(root, "SOUL.md"), "utf8").catch(() => ""),
    readFile(join(root, "IDENTITY.md"), "utf8").catch(() => ""),
    readFile(join(root, "INNER.md"), "utf8").catch(() => ""),
    readFile(join(root, "PRODUCER.md"), "utf8").catch(() => ""),
    readFile(join(root, "runtime", "heartbeat-state.json"), "utf8").catch(() => ""),
    latestObservationData(root),
    listSongStates(root).catch(() => []),
    readBudgetState(root, now),
    recentSpawnThemes(root, now)
  ]);
  const observation = obsData.raw;
  const observationSummary = obsData.summary;
  const budgetRemaining = budget.limit - budget.used;
  // Plan v10.38 Phase D: surface theme starvation. When the observation pool is
  // empty or near-empty, autopilot has been silently falling back to the same
  // hard-coded title ("静かな夜の勘定書" / "街の違和感") cycle after cycle. Emit
  // a runtime event so the producer sees the starvation in Telegram instead of
  // discovering it later through "another song with the same concept" pain.
  if (observation.trim().length < 12) {
    emitRuntimeEvent({
      type: "theme_starvation",
      source: "observation_empty",
      details: `observation length=${observation.trim().length} chars (need >= 12)`,
      timestamp: now.getTime()
    });
  }
  if (budgetRemaining <= 1 || hasRestMood(heartbeat, soulMd) || (!options.ignoreRecentCompletion && recentCompletedTooClose(songs, now)) || observation.trim().length < 12) {
    return null;
  }
  const inputContext = [artistMd, soulMd, identityMd, innerMd, producerMd, heartbeat, observation, JSON.stringify(songs.slice(0, 5)), JSON.stringify(budget)].join("\n");
  assertSafe("input", inputContext);

  const fingerprint = parseVoiceFingerprint(soulMd);
  const pitchContext = { observation, artistMd, soulMd, fingerprint };
  const fallback = buildBrief({ observation, artistMd, soulMd, fingerprint, budgetRemaining, now });
  // Plan v10.38 Phase F hallucination guard: stamp the fallback brief with
  // the observation entries it was actually built from so mock / not_configured
  // paths still leave a verifiable citation trail.
  fallback.sources = sourcesFromExcerpts(obsData.excerpts ?? []);
  const provider = options.aiReviewProvider ?? "mock";
  const mockReason = composeReasonInArtistVoice({ artistMd, soulMd, fingerprint, observation, brief: fallback });
  const raw = provider === "mock"
    ? [
      "spawn: yes",
      `title: ${fallback.title}`,
      `brief: ${fallback.brief}`,
      `lyricsTheme: ${fallback.lyricsTheme}`,
      `mood: ${fallback.mood}`,
      `tempo: ${fallback.tempo}`,
      `duration: ${fallback.duration}`,
      `style: ${fallback.styleNotes}`,
      `reason: ${mockReason}`
    ].join("\n")
    : await callAiProvider(buildPrompt({
      artistMd,
      soulMd,
      identityMd,
      innerMd,
      producerMd,
      observation,
      heartbeat,
      recentSongs: songs,
      budgetRemaining,
      recentThemes,
      fingerprint,
      observationExcerpts: obsData.excerpts,
      cascadeSeed: fallback.songId,
      activeQueueContext: options.activeQueueContext
    }), { provider });
  const safeRaw = isAiNotConfiguredResponse(raw) || secretLikePattern.test(raw) ? "" : raw;
  const parsed = briefFromAi(safeRaw, fallback, now, pitchContext);
  if (isSimilarTheme(parsed.brief, [...recentThemes, ...queueContextAsRecentThemes(options.activeQueueContext)])) {
    return null;
  }
  // Post-validate the reason: if voice fingerprint is ready and AI output violates contract,
  // replace the reason with a deterministic artist-voice line from composeArtistFallback.
  if (isVoiceFingerprintReady(fingerprint).ok) {
    const validation = validateAgainstVoiceContract(parsed.reason, {
      fingerprint,
      lastEndings: []
    });
    if (!validation.ok) {
      parsed.reason = composeReasonInArtistVoice({ artistMd, soulMd, fingerprint, observation, brief: parsed.brief });
    }
  }
  parsed.brief.lyricsTheme = normalizePitchField("lyricsTheme", parsed.brief.lyricsTheme, pitchContext);
  parsed.brief.styleNotes = dedupeStyleBpm(normalizePitchField("styleNotes", parsed.brief.styleNotes, pitchContext), parsed.brief.tempo);
  parsed.reason = normalizePitchField("reason", parsed.reason, pitchContext);
  // v10.25: brief-anchored reason guarantee. If reason fell back to motif-only
  // (no brief title reference), force a brief-anchored line so the spawn voice
  // does not leak previous song context. Skip when context is thin -- thin
  // path keeps short honest markers per validPitchField contract.
  if (
    !isThinPitchContext(pitchContext) &&
    parsed.brief.title &&
    !parsed.reason.includes(parsed.brief.title)
  ) {
    const briefAnchored = composeReasonFromBrief(parsed.brief, fingerprint, pitchContext);
    if (briefAnchored) parsed.reason = briefAnchored;
  }
  const finalText = JSON.stringify(parsed.brief) + parsed.reason;
  assertSafe("final", finalText);
  return parsed.spawn ? {
    spawn: true,
    brief: parsed.brief,
    reason: parsed.reason,
    candidateSongId: parsed.brief.songId,
    observationSummary
  } : null;
}
