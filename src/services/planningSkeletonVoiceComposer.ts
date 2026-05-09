import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiReviewProvider } from "../types.js";
import { readArtistVoiceContext } from "./artistVoiceResponder.js";
import { extractPersonaMotifs, type PersonaMotifBundle } from "./personaMotifExtractor.js";
import { parseVoiceFingerprint, type VoiceFingerprintBundle } from "./voiceFingerprintParser.js";
import { secretLikePattern } from "./personaMigrator.js";

export interface ComposePlanningVoiceInput {
  workspaceRoot: string;
  songId: string;
  missing: string[];
  aiReviewProvider?: AiReviewProvider;
}

interface BriefSlots {
  title?: string;
  coreTheme?: string;
  mood?: string;
  styleNotes?: string;
  observationQuote?: string;
  observationAuthor?: string;
  observationUrl?: string;
}

const FALLBACK_MONOLOG = "次の曲、まず骨組み。これで進めていい?";

const PLACEHOLDER_PATTERN = /^[\s\-*•・]*(?:tbd|todo|fixme|未定|未記入|none|n\/a|—|–|-|\?+|unknown)[\s\-*•・]*$/i;

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERN.test(trimmed);
}

function isFullTweetUrl(url: string | undefined): url is string {
  return !!url && /^https:\/\/(?:twitter|x)\.com\/[A-Za-z0-9_]+\/status\/\d+/.test(url);
}

function readBriefSlots(briefMd: string): BriefSlots {
  if (!briefMd) return {};
  const titleRaw = briefMd.match(/^#\s+Brief for\s+(.+)$/m)?.[1]?.trim();
  const coreThemeRaw = briefMd.match(/^- Core theme:\s*(.+)$/m)?.[1]?.trim();
  const moodRaw = briefMd.match(/^- Mood:\s*(.+)$/m)?.[1]?.trim();
  const styleNotesRaw = briefMd.match(/^- Style notes:\s*(.+)$/m)?.[1]?.trim();
  const observationQuoteRaw = briefMd.match(/^- Quote:\s*(.+)$/m)?.[1]?.trim();
  const observationAuthorRaw = briefMd.match(/^- Author:\s*(.+)$/m)?.[1]?.trim();
  const observationUrlRaw = briefMd.match(/^- URL:\s*(.+)$/m)?.[1]?.trim();
  return {
    title: isPlaceholder(titleRaw) ? undefined : titleRaw,
    coreTheme: isPlaceholder(coreThemeRaw) ? undefined : coreThemeRaw,
    mood: isPlaceholder(moodRaw) ? undefined : moodRaw,
    styleNotes: isPlaceholder(styleNotesRaw) ? undefined : styleNotesRaw,
    observationQuote: isPlaceholder(observationQuoteRaw) ? undefined : observationQuoteRaw,
    observationAuthor: isPlaceholder(observationAuthorRaw) ? undefined : observationAuthorRaw,
    observationUrl: observationUrlRaw && !isPlaceholder(observationUrlRaw) ? observationUrlRaw : undefined
  };
}

function hashKey(songId: string, missing: string[]): number {
  const input = `${songId}|${[...missing].sort().join("/")}`;
  const digest = createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0);
}

function pickFromHash<T>(values: T[], hash: number, offset: number): T {
  return values[(hash + offset) % values.length];
}

function trimQuote(raw: string): string {
  return raw.replace(/^["「『]+|["」』]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 36);
}

function buildMotifSentence(slots: BriefSlots, motifs: PersonaMotifBundle, hash: number): string {
  const core = slots.coreTheme;
  const theme = motifs.themes[hash % Math.max(motifs.themes.length, 1)];
  const geo = motifs.geographies[hash % Math.max(motifs.geographies.length, 1)];
  if (core && theme && geo) {
    const variants = [
      `この曲は${core}、${theme}の視点から${geo}で削る、ずっと抱えてた角度だ。`,
      `${core}に${theme}の癖を乗せる、${geo}の音で書く。`,
      `${core}を${theme}の側から刺す、${geo}の手触りで一本通すつもりだ。`
    ];
    return pickFromHash(variants, hash, 0);
  }
  if (core && theme) {
    const variants = [
      `この曲は${core}、${theme}の角度で書く、自分の癖が出る場所だと思う。`,
      `${core}を${theme}でしか書けない手触りで通す。`,
      `${core}を${theme}側から削る、ずっと抱えてた重さだ。`
    ];
    return pickFromHash(variants, hash, 0);
  }
  if (core) {
    const variants = [
      `この曲は${core}の話だ、ずっと抱えてた重さを今日鳴らす。`,
      `${core}を観察の温度のまま削る、自分の癖が出る場所だと思う。`,
      `この曲は${core}、cold で刺すしかない手触りだ。`
    ];
    return pickFromHash(variants, hash, 0);
  }
  if (theme && geo) {
    const variants = [
      `次の曲、${geo}から${theme}を切る角度を取る。`,
      `次の曲は${theme}、${geo}の路地の手触りで書く。`,
      `次の曲、${geo}の音が${theme}を呼んでる、それを掴んだ。`
    ];
    return pickFromHash(variants, hash, 0);
  }
  if (theme) {
    return `次の曲、今は${theme}を音にしたい、それだけは確かだ。`;
  }
  return "次の曲、観察の温度をそのまま音にする、それで行く。";
}

function buildObservationSentence(slots: BriefSlots, hash: number): string {
  const trimmed = slots.observationQuote ? trimQuote(slots.observationQuote) : "";
  const author = slots.observationAuthor;
  const url = isFullTweetUrl(slots.observationUrl) ? slots.observationUrl : undefined;
  if (trimmed.length > 0 && author && url) {
    const attribution = `(@${author} · ${url})`;
    const variants = [
      `「${trimmed}」 ${attribution} が観察ログに残ったんだ。`,
      `観察で「${trimmed}」を拾った ${attribution}、それが入り口だな。`,
      `タイムラインの「${trimmed}」が刺さってる ${attribution}、忘れたくない。`
    ];
    return pickFromHash(variants, hash, 1);
  }
  const variants = [
    "観察ログから音にする入り口を、今日 1 つ拾った。",
    "今日の観察に、刺さる断片が 1 つあったわ。",
    "今朝の信号、ひとつ残してある。それを起点にする。"
  ];
  return pickFromHash(variants, hash, 1);
}

function humanizeMood(rawMood: string | undefined): string {
  const clean = (rawMood ?? "").toLowerCase();
  if (!clean) return "観察者の温度";
  if (/tense|urgent|pressure|緊張/.test(clean)) return "緊張感のある";
  if (/cold|quiet|静か/.test(clean)) return "cold";
  if (/sarcasm|cynical|皮肉|風刺/.test(clean)) return "皮肉";
  if (/observ/.test(clean)) return "観察の温度";
  if (/dark|sombre|sober/.test(clean)) return "陰の手触り";
  return "観察者の温度";
}

function humanizeStyle(rawStyle: string | undefined): string | undefined {
  const clean = (rawStyle ?? "").toLowerCase();
  if (!clean) return undefined;
  if (/thick bass|deep bass|低音/.test(clean)) return "厚い低音";
  if (/restrained drum|controlled drum|抑制/.test(clean)) return "削いだドラム";
  if (/unsentimental|dry|sober/.test(clean)) return "感傷を抜いたヴォーカル";
  if (/nu.?jazz|jazz/.test(clean)) return "nu-jazz の輪郭";
  if (/hip.?hop|rap/.test(clean)) return "hip-hop の骨格";
  if (/synth|electronic/.test(clean)) return "電子の骨組み";
  return undefined;
}

function buildLogicSentence(slots: BriefSlots, hash: number): string {
  const moodSource = slots.mood?.split(",")[0]?.trim();
  const mood = humanizeMood(moodSource);
  const style = humanizeStyle(slots.styleNotes?.split(",")[0]?.trim());
  if (style) {
    const variants = [
      `${mood}のまま、${style}で骨だけ残す。`,
      `${mood}を芯にして、${style}でいく、嘘にならない気がする。`,
      `${mood}と${style}、それが今日の輪郭だ。`
    ];
    return pickFromHash(variants, hash, 2);
  }
  const variants = [
    `${mood}を保ったまま短く叩く、それで行く。`,
    `${mood}のまま、要らない言葉は切り捨てる。`,
    `${mood}を芯にして、骨だけ残すんだ。`
  ];
  return pickFromHash(variants, hash, 2);
}

function buildClosingSentence(_missing: string[], hash: number): string {
  const variants = [
    "ここから一緒に hash out したい、これで進めていいかな?",
    "委ねたい部分は委ねる、これで通すか?",
    "骨組みはこれで通す。ここから lyrics と style に入って、行ってよし?",
    "この角度で行く、合ってる気がする。これで進めていい?"
  ];
  return pickFromHash(variants, hash, 3);
}

function applyForbiddenFilter(sentences: string[], fingerprint: VoiceFingerprintBundle | null): string[] {
  if (!fingerprint) return sentences;
  const phrases = (fingerprint.forbiddenPhrases ?? []).map((p) => p.trim()).filter(Boolean);
  if (phrases.length === 0) return sentences;
  return sentences.filter((sentence) => !phrases.some((phrase) => sentence.includes(phrase)));
}

export async function composePlanningSkeletonVoice(input: ComposePlanningVoiceInput): Promise<string> {
  const briefPath = join(input.workspaceRoot, "songs", input.songId, "brief.md");
  const [voiceContext, briefMd] = await Promise.all([
    readArtistVoiceContext(input.workspaceRoot).catch(() => null),
    readFile(briefPath, "utf8").catch(() => "")
  ]);

  const motifs = extractPersonaMotifs(
    [voiceContext?.artistMd ?? "", voiceContext?.soulMd ?? ""].join("\n")
  );
  const fingerprint = voiceContext?.soulMd ? parseVoiceFingerprint(voiceContext.soulMd) : null;
  const slots = readBriefSlots(briefMd);

  if (slots.observationQuote && secretLikePattern.test(slots.observationQuote)) {
    slots.observationQuote = undefined;
  }
  if (slots.coreTheme && secretLikePattern.test(slots.coreTheme)) {
    slots.coreTheme = undefined;
  }

  const hash = hashKey(input.songId, input.missing);
  const motifSentence = buildMotifSentence(slots, motifs, hash);
  const observationSentence = buildObservationSentence(slots, hash);
  const logicSentence = buildLogicSentence(slots, hash);
  const closingSentence = buildClosingSentence(input.missing, hash);

  const patternA = (hash & 1) === 0;
  const ordered = patternA
    ? [motifSentence, observationSentence, logicSentence, closingSentence]
    : [observationSentence, motifSentence, logicSentence, closingSentence];

  const filtered = applyForbiddenFilter(ordered, fingerprint);

  if (filtered.length < 3) return FALLBACK_MONOLOG;
  return filtered.join("\n");
}
