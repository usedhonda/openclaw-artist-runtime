import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider, CommissionBrief, ObservationSummary, SongState, SpawnProposal } from "../types.js";
import { callAiProvider, isAiNotConfiguredResponse } from "./aiProviderClient.js";
import { composeArtistFallback } from "./artistVoiceComposer.js";
import { listSongStates } from "./artistState.js";
import { readCallbackActionEntries } from "./callbackActionRegistry.js";
import { extractPersonaMotifs } from "./personaMotifExtractor.js";
import { secretLikePattern } from "./personaMigrator.js";
import { readBudgetState } from "./sunoBudgetLedger.js";
import { validateAgainstVoiceContract } from "./voiceContractValidator.js";
import { isVoiceFingerprintReady, parseVoiceFingerprint, type VoiceFingerprintBundle } from "./voiceFingerprintParser.js";
import { readObservationsReport } from "./xObservationCollector.js";

const FULL_TWEET_URL_PATTERN = /^https:\/\/(?:twitter|x)\.com\/[^/\s]+\/status\/\d+/i;

export interface ProposeSpawnOptions {
  aiReviewProvider?: AiReviewProvider;
  now?: Date;
}

function assertSafe(stage: string, value: string): void {
  if (secretLikePattern.test(value)) {
    throw new Error(`song_spawn_secret_like_${stage}`);
  }
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

interface LatestObservationData {
  raw: string;
  summary?: ObservationSummary;
}

async function latestObservationData(root: string): Promise<LatestObservationData> {
  const dir = join(root, "observations");
  const entries = await readdir(dir).catch(() => []);
  const latest = entries.filter((entry) => entry.endsWith(".md")).sort().at(-1);
  if (!latest) return { raw: "" };
  const raw = await readFile(join(dir, latest), "utf8").catch(() => "");
  if (!raw) return { raw: "" };
  const dateStr = latest.replace(/\.md$/, "");
  const report = await readObservationsReport(root, dateStr).catch(() => null);
  if (!report || report.entries.length === 0) {
    return { raw };
  }
  const sorted = [...report.entries].sort((a, b) => (b.motifScore ?? 0) - (a.motifScore ?? 0));
  for (const entry of sorted) {
    if (!entry.url || !FULL_TWEET_URL_PATTERN.test(entry.url)) continue;
    if (!entry.author || entry.author === "_") continue;
    const quote = (entry.text ?? "").trim();
    if (!quote) continue;
    if (secretLikePattern.test(quote)) continue;
    return {
      raw,
      summary: {
        quote: quote.slice(0, 240),
        author: entry.author,
        url: entry.url
      }
    };
  }
  return { raw };
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

function isSimilarTheme(title: string, recentThemes: string[]): boolean {
  const normalized = normalizeTheme(title);
  if (normalized.length < 3) {
    return false;
  }
  return recentThemes.some((theme) => {
    const recent = normalizeTheme(theme);
    if (recent.length < 3) {
      return false;
    }
    return normalized.includes(recent) || recent.includes(normalized);
  });
}

async function recentSpawnThemes(root: string, now: Date): Promise<string[]> {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  const entries = await readCallbackActionEntries(root).catch(() => []);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.createdAt < cutoff || !entry.commissionBrief?.title || !entry.action.startsWith("song_spawn_")) {
      continue;
    }
    seen.add(entry.commissionBrief.title);
  }
  return [...seen].slice(-12);
}

function titleFromSeed(seed: string, motifs?: ReturnType<typeof extractPersonaMotifs>): string {
  // v10.26: motif-anchored title takes priority. The observation slice was
  // producing raw text fragments like "六本木の古いビルの影で、 経営者が若者の声を看板"
  // -- not a song title. Motif pair (geo + theme) yields short, song-like names
  // ("六本木の社会風刺", "渋谷の皮肉"). Fall back to observation only when
  // motifs are sparse.
  if (motifs) {
    const themeWord = motifs.themes[0]?.split(/[\/|,、]/)[0]?.trim();
    const geoWord = motifs.geographies[0]?.split(/[\/|,、]/)[0]?.trim();
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

function firstPhrase(values: string[], fallback: string): string {
  return values.find((value) => value.trim().length > 0)?.split(/[\/|,、]/)[0]?.trim() || fallback;
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
    place: firstPhrase(motifs.geographies, "街"),
    object: firstPhrase(motifs.vocabulary, firstPhrase(motifs.themes, "ざらつき")),
    sound: firstPhrase(motifs.sound, "低いベース"),
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

function buildBrief(context: { observation: string; artistMd: string; soulMd: string; fingerprint: VoiceFingerprintBundle; budgetRemaining: number; now: Date }): CommissionBrief {
  const seed = context.observation || context.soulMd || "観察が薄い夜に、街の温度だけ残っている。";
  const titleMotifs = extractPersonaMotifs([context.artistMd, context.soulMd].join("\n"));
  const title = titleFromSeed(seed, titleMotifs);
  const themeWord = titleMotifs.themes[0]?.split(/[\/|,、]/)[0]?.trim();
  const placeWord = titleMotifs.geographies[0]?.split(/[\/|,、]/)[0]?.trim();
  const objectWord = titleMotifs.vocabulary[0]?.split(/[\/|,、]/)[0]?.trim();
  const briefSentence = themeWord && placeWord
    ? `${placeWord}で見た${objectWord ?? "違和感"}を、${themeWord}として切る一曲`
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
  recentThemes: string[];
  fingerprint: VoiceFingerprintBundle;
}): string {
  const lines: string[] = [
    "System: あなたは used::honda 本人。 producer に新曲を提案する artist として一人称で書く。",
    "Decision: 観察と heartbeat から、 今 新曲を始めるべきか判断する。 不十分なら spawn: no。",
    "Avoid any subject or title already listed in recently proposed themes.",
    "Never include secrets. Keep the brief lean enough for autopilot planning.",
    "",
    "出力 schema (1 行ずつ、 順序固定):",
    "spawn: <yes/no>",
    "title: <artistic title>",
    "brief: <280 chars 以内、 楽曲の中身要約>",
    "lyricsTheme: <2-4 文、 日本語、 sub 構造込み。最低 2 文。例: \"六本木で見た経営者を社会風刺として切る。サビは短く 1 行のリフレインだけ、ヴァースで景色を出してサビでそれを 1 行に畳む。\">",
    "mood: <english spec keywords e.g. 'tense, late-night, urban pressure'>",
    "tempo: <'artist decides' or '142 BPM'>",
    "duration: <'2:45' 等>",
    "style: <english spec keywords + instrumentation roles. 最低 3 要素。例: \"thick bass on low register, restrained hi-hats, vocals nestled between instruments, sparse arrangement, breathing space\">",
    "reason: <**日本語のみ**、 artist 一人称口語、 producer に話しかける 1 行 (e.g. \"" + (context.fingerprint.producerCallname ?? "ゆずる") + "、 〜の街を切るやつ、 刺さる\")>",
    "",
    ...buildVoiceContractLines(context.fingerprint),
    "",
    `Budget remaining: ${context.budgetRemaining}`,
    `Recent songs: ${context.recentSongs.slice(0, 5).map((song) => `${song.songId}:${song.status}:${song.title}`).join(" | ")}`,
    `Recently proposed themes to avoid: ${context.recentThemes.length > 0 ? context.recentThemes.join(" | ") : "none"}`,
    "",
    "Latest observations:",
    context.observation.slice(0, 1200),
    "",
    "Heartbeat:",
    context.heartbeat.slice(0, 500),
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
  return {
    spawn,
    reason: normalizePitchField("reason", parseDirective(raw, "reason"), context),
    brief: {
      ...fallback,
      title,
      brief,
      lyricsTheme: normalizePitchField("lyricsTheme", parseDirective(raw, "lyricsTheme") || parseDirective(raw, "lyrics"), context),
      mood: parseDirective(raw, "mood") || fallback.mood,
      tempo: parseDirective(raw, "tempo") || fallback.tempo,
      duration: parseDirective(raw, "duration") || fallback.duration,
      styleNotes: normalizePitchField("styleNotes", parseDirective(raw, "style"), context),
      createdAt: now.toISOString()
    }
  };
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

function composeReasonFromBrief(
  brief: CommissionBrief,
  fingerprint: VoiceFingerprintBundle,
  context: PitchDensityContext
): string | undefined {
  const callname = fingerprint.producerCallname ?? "ゆずるさん";
  const title = brief.title?.trim();
  const briefSummary = (brief.brief ?? "").replace(/[。.]+\s*$/u, "").trim().slice(0, 90);
  if (!title || !briefSummary) return undefined;
  const slots = pitchSlots(context);
  const candidates = [
    `${callname}、 「${title}」 を書きたいんだ。 ${briefSummary}、 これを${slots.sound}と短いフックに委ねたい。 怖さは残るけど、 逃がさないな。`,
    `${callname}、 「${title}」 で 1 曲、 やらせてくれ。 ${briefSummary}、 そのまま置いて言い切らずに残す。 ${slots.sound}と余白で刺すな。`
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

export async function proposeSpawn(root: string, options: ProposeSpawnOptions = {}): Promise<SpawnProposal | null> {
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
  if (budgetRemaining <= 1 || hasRestMood(heartbeat, soulMd) || recentCompletedTooClose(songs, now) || observation.trim().length < 12) {
    return null;
  }
  const inputContext = [artistMd, soulMd, identityMd, innerMd, producerMd, heartbeat, observation, JSON.stringify(songs.slice(0, 5)), JSON.stringify(budget)].join("\n");
  assertSafe("input", inputContext);

  const fingerprint = parseVoiceFingerprint(soulMd);
  const pitchContext = { observation, artistMd, soulMd, fingerprint };
  const fallback = buildBrief({ observation, artistMd, soulMd, fingerprint, budgetRemaining, now });
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
      fingerprint
    }), { provider });
  const safeRaw = isAiNotConfiguredResponse(raw) || secretLikePattern.test(raw) ? "" : raw;
  const parsed = briefFromAi(safeRaw, fallback, now, pitchContext);
  if (isSimilarTheme(parsed.brief.title, recentThemes)) {
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
  parsed.brief.styleNotes = normalizePitchField("styleNotes", parsed.brief.styleNotes, pitchContext);
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
