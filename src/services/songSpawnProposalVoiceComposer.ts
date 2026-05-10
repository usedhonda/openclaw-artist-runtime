import { createHash } from "node:crypto";
import type { CommissionBrief, ObservationSummary } from "../types.js";
import { buildSongPitchContext, type SectionKey, type SongPitchContext } from "./songPitchContext.js";

export interface ComposeSongSpawnProposalVoiceInput {
  workspaceRoot: string;
  songId: string;
  brief?: CommissionBrief;
  reason?: string;
  observation?: ObservationSummary;
}

const FALLBACK_VOICE = "次の曲、まず骨組みから話したい。これで進めていい?";

function hashKey(songId: string, sections: Set<SectionKey>): number {
  const input = `${songId}|${[...sections].sort().join("/")}`;
  const digest = createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0);
}

function pickFromHash<T>(values: T[], hash: number, offset: number): T {
  return values[(hash + offset) % values.length];
}

function trimQuote(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 70);
}

function buildOpening(context: SongPitchContext, hash: number): string {
  const callname = context.fingerprint?.producerCallname?.trim();
  const variants = callname
    ? [
      `${callname}、次の曲の話、ちょっと聴いてほしい。`,
      `${callname}、新しい一曲、頭の中で組み始めた。`,
      `${callname}、今日はこの曲を提案させて。`
    ]
    : [
      "次の曲の話、ちょっと聴いてほしい。",
      "新しい一曲、頭の中で組み始めた。",
      "今日はこの曲を提案させて。"
    ];
  return pickFromHash(variants, hash, 0);
}

function buildObservation(context: SongPitchContext, hash: number, isThin: boolean): string {
  const obs = context.observation;
  if (obs && obs.author && obs.url) {
    const trimmed = trimQuote(obs.quote);
    const variants = [
      `「${trimmed}」 (@${obs.author} · ${obs.url}) が観察ログに残ってる。これが入り口だな。`,
      `観察で「${trimmed}」を拾った (@${obs.author} · ${obs.url})。忘れたくない一行。`,
      `タイムラインで「${trimmed}」が刺さってる (@${obs.author} · ${obs.url})。ここから始める。`
    ];
    return pickFromHash(variants, hash, 1);
  }
  if (isThin) {
    return "観察はまだ薄い、断片しか拾えてない。それでも種は今日のうちに残しておきたい。";
  }
  const variants = [
    "観察ログから音にする入り口を、今日 1 つ拾った。",
    "今日の観察に、刺さる断片が 1 つあったわ。"
  ];
  return pickFromHash(variants, hash, 1);
}

function buildSong(context: SongPitchContext, hash: number, isThin: boolean): string {
  const title = context.title;
  const core = context.coreTheme?.replace(/[。.、,!?！？]+$/u, "").trim();
  const motifs = context.motifs;
  const theme = motifs.themes[hash % Math.max(motifs.themes.length, 1)];
  const geo = motifs.geographies[hash % Math.max(motifs.geographies.length, 1)];
  if (title && core) {
    if (theme && geo) {
      const variants = [
        `『${title}』って呼んでる。${core}の話だ。${theme}の角度から${geo}で削る、ずっと抱えてた重さを今日鳴らしたい。`,
        `『${title}』。${core}を${theme}側から刺す、${geo}の手触りで一本通すつもり。`,
        `仮で『${title}』。${core}を、${geo}の${theme}として書く、自分の癖が出る場所だと思う。`
      ];
      return pickFromHash(variants, hash, 2);
    }
    return `『${title}』、${core}の話だ。ずっと抱えてた重さを今日鳴らす。`;
  }
  if (core) {
    if (theme) {
      return `この曲は${core}の話だ。${theme}側から削る、自分の癖が出る場所だと思う。`;
    }
    return `この曲は${core}の話だ。自分の癖が出る場所だと思う。`;
  }
  if (title) {
    return `『${title}』っていう仮タイトルで動かす。中身はこれから組む。`;
  }
  if (isThin) {
    return "タイトルも切り口も、まだ仮で握ってるところ。手触りはあるんだけど、まだ言葉になってない。";
  }
  return "次の曲、輪郭は掴んでる、書きながら詰める。";
}

function buildMoodTempoDuration(context: SongPitchContext, hash: number): string | undefined {
  const parts: string[] = [];
  if (context.mood) parts.push(`${context.mood.humanized}空気で`);
  if (context.tempo) parts.push(context.tempo.humanized);
  if (context.duration) {
    const dur = context.duration.humanized;
    parts.push(/^長さ/.test(dur) ? dur : `長さは${dur}`);
  }
  if (parts.length === 0) return undefined;
  const joined = parts.join("、");
  const closer = pickFromHash([
    "これで合ってる気がする。",
    "音の体温、これで正しい気がする。",
    "ここから外したくない温度感だ。"
  ], hash, 3);
  return `${joined}。${closer}`;
}

function buildLyrics(context: SongPitchContext): string | undefined {
  const theme = context.lyricsTheme?.trim();
  if (!theme) return undefined;
  return `歌詞は、${theme}`;
}

function buildStyle(context: SongPitchContext, hash: number): string | undefined {
  if (!context.styleNotes) return undefined;
  const closer = pickFromHash([
    "骨だけ残して、贅肉は後で削る。",
    "余白を多く残して、必要な音だけ立てる。",
    "音の空隙ごと、自分の手で抱える。"
  ], hash, 4);
  return `音は、${context.styleNotes.humanized}で組む。${closer}`;
}

function buildReason(context: SongPitchContext): string | undefined {
  const reason = context.reason?.trim();
  if (!reason) return undefined;
  return reason;
}

function buildClosing(context: SongPitchContext, hash: number, isThin: boolean): string {
  if (isThin) {
    const variants = [
      "まだ言葉にできてない部分があるけど、進めながら肉付けしたい、どう?",
      "輪郭しかない段階だ。骨だけでいいか、これで進めて、ここから一緒に詰めていきたい。",
      "正直、まだ薄い。それでも種は残しておきたい、今ここで。"
    ];
    return pickFromHash(variants, hash, 5);
  }
  const variants = [
    "この骨組みで進めていい? 嘘になっていないか、一緒に確かめてほしい。",
    "ここから一緒に hash out したい、これで通すか?",
    "この角度で行く、合ってる気がする。これで進めていい?",
    "骨組みはこれで通す。ここから lyrics と style に入って、行ってよし?"
  ];
  return pickFromHash(variants, hash, 5);
}

function applyForbiddenFilter(sentences: string[], context: SongPitchContext): string[] {
  if (!context.fingerprint) return sentences;
  const phrases = (context.fingerprint.forbiddenPhrases ?? []).map((p) => p.trim()).filter(Boolean);
  if (phrases.length === 0) return sentences;
  return sentences.filter((sentence) => !phrases.some((phrase) => sentence.includes(phrase)));
}

export async function composeSongSpawnProposalVoice(input: ComposeSongSpawnProposalVoiceInput): Promise<string> {
  const context = await buildSongPitchContext({
    workspaceRoot: input.workspaceRoot,
    songId: input.songId,
    brief: input.brief,
    reason: input.reason,
    observation: input.observation
  });
  const isThin = context.filledSections.size <= 4;
  const hash = hashKey(input.songId, context.filledSections);

  const sections: string[] = [];
  sections.push(buildOpening(context, hash));
  sections.push(buildObservation(context, hash, isThin));
  sections.push(buildSong(context, hash, isThin));

  const moodTempo = buildMoodTempoDuration(context, hash);
  if (moodTempo) sections.push(moodTempo);

  const lyrics = buildLyrics(context);
  if (lyrics) sections.push(lyrics);

  const style = buildStyle(context, hash);
  if (style) sections.push(style);

  const reason = buildReason(context);
  if (reason && !sections.some((s) => s.includes(reason))) {
    sections.push(reason);
  }

  sections.push(buildClosing(context, hash, isThin));

  const filtered = applyForbiddenFilter(sections, context);
  if (filtered.length < 3) return FALLBACK_VOICE;
  return filtered.join("\n");
}
