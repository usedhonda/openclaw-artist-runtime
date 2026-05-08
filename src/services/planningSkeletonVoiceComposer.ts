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
  coreTheme?: string;
  mood?: string;
  observationQuote?: string;
}

const FALLBACK_MONOLOG = "次の曲、まず骨組み。これで進めていい?";

function readBriefSlots(briefMd: string): BriefSlots {
  if (!briefMd) return {};
  const coreTheme = briefMd.match(/^- Core theme:\s*(.+)$/m)?.[1]?.trim();
  const mood = briefMd.match(/^- Mood:\s*(.+)$/m)?.[1]?.trim();
  const observationQuote = briefMd.match(/^- Quote:\s*(.+)$/m)?.[1]?.trim();
  return { coreTheme, mood, observationQuote };
}

function hashKey(songId: string, missing: string[]): number {
  const input = `${songId}|${[...missing].sort().join("/")}`;
  const digest = createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0);
}

function pickFromHash<T>(values: T[], hash: number, offset: number): T {
  return values[(hash + offset) % values.length];
}

function humanizeMissing(fields: string[]): string {
  const labels: Record<string, string> = {
    tempo: "テンポ",
    duration: "長さ",
    "style notes": "style",
    "lyrics theme": "テーマ",
    mood: "ムード"
  };
  const humanized = fields.map((f) => labels[f] ?? f).filter(Boolean);
  if (humanized.length === 0) return "細部";
  if (humanized.length === 1) return humanized[0];
  if (humanized.length === 2) return `${humanized[0]}と${humanized[1]}`;
  return `${humanized.slice(0, -1).join("、")}と${humanized.at(-1)}`;
}

function trimQuote(raw: string): string {
  return raw.replace(/^["「『]+|["」』]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 36);
}

function buildMotifSentence(motifs: PersonaMotifBundle, hash: number): string {
  const theme = motifs.themes[hash % Math.max(motifs.themes.length, 1)];
  const geo = motifs.geographies[hash % Math.max(motifs.geographies.length, 1)];
  if (theme && geo) {
    const variants = [
      `${geo}から${theme}を切る、それが今日の俺の角度だ。`,
      `${theme}は${geo}の路地で熟してる、放っておけないな。`,
      `${geo}の音が${theme}を呼んでる、無視したくない。`
    ];
    return pickFromHash(variants, hash, 0);
  }
  if (theme) {
    const variants = [
      `今は${theme}が頭から離れない、それを音にしたい。`,
      `${theme}の重さ、まだ降ろせない。今日も鳴らす。`,
      `${theme}を、もう一度こちら側で言い直す。`
    ];
    return pickFromHash(variants, hash, 0);
  }
  return "次の曲、観察の温度をそのまま音にしたい。";
}

function buildObservationSentence(slots: BriefSlots, hash: number): string {
  if (slots.observationQuote) {
    const trimmed = trimQuote(slots.observationQuote);
    if (trimmed.length > 0) {
      const variants = [
        `「${trimmed}」、この声が観察ログに残ったんだ。`,
        `観察で「${trimmed}」を拾った、それが入り口だな。`,
        `タイムラインの「${trimmed}」が刺さってる、忘れたくない。`
      ];
      return pickFromHash(variants, hash, 1);
    }
  }
  const variants = [
    "観察ログから音にする入り口を、今日 1 つ拾った。",
    "今日の観察に、刺さる断片が 1 つあったわ。",
    "今朝の信号、ひとつ残してある。それを起点にする。"
  ];
  return pickFromHash(variants, hash, 1);
}

function buildLogicSentence(slots: BriefSlots, hash: number): string {
  const moodRaw = slots.mood?.split(",")[0]?.trim() ?? "観察者の温度";
  const mood = moodRaw.length > 24 ? `${moodRaw.slice(0, 24)}…` : moodRaw;
  const core = slots.coreTheme;
  if (core) {
    const variants = [
      `${core}を、${mood}で削るつもりだ。`,
      `${core}、${mood}でいけば嘘にならないな。`,
      `${core}を選んだのは、${mood}の方が刺さるからだ。`
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

function buildQuestionSentence(missing: string[], hash: number): string {
  const humanized = humanizeMissing(missing);
  const variants = [
    `${humanized}は埋めた、これで進めていい?`,
    `${humanized}の案、出した。これで通すか?`,
    `${humanized}はもう書いた、行ってよし?`
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
  const motifSentence = buildMotifSentence(motifs, hash);
  const observationSentence = buildObservationSentence(slots, hash);
  const logicSentence = buildLogicSentence(slots, hash);
  const questionSentence = buildQuestionSentence(input.missing, hash);

  const patternA = (hash & 1) === 0;
  const ordered = patternA
    ? [motifSentence, observationSentence, logicSentence, questionSentence]
    : [observationSentence, motifSentence, logicSentence, questionSentence];

  const filtered = applyForbiddenFilter(ordered, fingerprint);

  if (filtered.length < 3) return FALLBACK_MONOLOG;
  return filtered.join("\n");
}
