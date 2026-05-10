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
  const title = context.title;
  const core = context.coreTheme?.replace(/[。.、,!?！？]+$/u, "").trim();
  const motifs = context.motifs;
  const theme = motifs.themes[hash % Math.max(motifs.themes.length, 1)]?.split(/[\/|,、]/)[0]?.trim();
  const geo = motifs.geographies[hash % Math.max(motifs.geographies.length, 1)]?.split(/[\/|,、]/)[0]?.trim();

  const candidates: string[] = [];
  if (title && core) {
    candidates.push(`『${title}』のことで、ちょっと聴いてほしい。`);
    candidates.push(`次に『${title}』を書く、${core}の話だ。`);
  } else if (title) {
    candidates.push(`『${title}』、頭の中で組み始めてる。`);
    candidates.push(`仮で『${title}』って呼んでる、聴いてくれ。`);
  }
  if (core) {
    candidates.push(`${core}を音にしたい、今日それが頭から離れない。`);
    candidates.push(`${core}が引っかかってる、形にする時だ。`);
  }
  if (theme && geo) {
    candidates.push(`${geo}で見た${theme}を、次の一曲に置きたい。`);
  } else if (theme) {
    candidates.push(`${theme}の側から、次の曲を切るつもりだ。`);
  }
  if (callname) {
    candidates.push(`${callname}、新しい一曲、組み始めた。聴いてくれ。`);
    candidates.push(`${callname}、今日はこの曲を提案させて。`);
  } else {
    candidates.push("次の曲、組み始めた。聴いてほしい。");
    candidates.push("新しい一曲、頭の中で動き出した。");
  }
  if (candidates.length === 0) {
    return callname ? `${callname}、次の曲の話、聴いてほしい。` : "次の曲の話、聴いてほしい。";
  }
  return pickFromHash(candidates, hash, 0);
}

function buildObservation(context: SongPitchContext, hash: number, isThin: boolean): string {
  const obs = context.observation;
  if (obs && obs.author && obs.url) {
    const trimmed = trimQuote(obs.quote);
    const tail = pickFromHash([
      "なんでだろう、街がまた 1 つ温度を下げた気がした。",
      "見ないふりして通り過ぎられない、そういう一行だ。",
      "短い言葉ほど、長く残る。これがまさにそれだった。"
    ], hash, 6);
    const variants = [
      `「${trimmed}」 (@${obs.author} · ${obs.url}) — このひとことが、ずっと頭に残ってる。${tail}`,
      `タイムラインで「${trimmed}」を見た (@${obs.author} · ${obs.url})。忘れたくない一行だ。${tail}`,
      `「${trimmed}」って書いてた人がいた (@${obs.author} · ${obs.url})。ここから入る。${tail}`
    ];
    return pickFromHash(variants, hash, 1);
  }
  if (isThin) {
    return "今日はまだ拾えた断片しかない。それでも種は残しておきたい、形になる前のものほど大事だから。";
  }
  const variants = [
    "今日のタイムラインから、音にする入り口を 1 つ拾った。書かないと、明日には忘れてしまう種だ。",
    "今日見た中で、刺さる断片が 1 つあった。短いけれど、抱えてる重さは厚い。"
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
    const tail = pickFromHash([
      "書かないと忘れてしまう、そんな種だ。",
      "今日のうちに音にしないと、輪郭が薄れていく。",
      "曲にする以外で、この違和感の置き場が思いつかない。",
      "他のやり方では、たぶん通らない。"
    ], hash, 7);
    if (theme && geo) {
      const variants = [
        `『${title}』、${core}。${theme}を${geo}の手触りで刺す、ずっと抱えてた重さを今日鳴らしたい。${tail}`,
        `『${title}』。${core}、${theme}側からしか書けない角度で書く。${tail}`,
        `仮で『${title}』。${core}、${geo}で削るしかない手触りだ。${tail}`
      ];
      return pickFromHash(variants, hash, 2);
    }
    const variants = [
      `『${title}』、${core}。ずっと抱えてた重さを今日鳴らす。${tail}`,
      `『${title}』。${core}、自分の癖が出る場所だと思う。${tail}`,
      `仮で『${title}』、${core}。書きながら詰める。${tail}`
    ];
    return pickFromHash(variants, hash, 2);
  }
  if (core) {
    if (theme) {
      return `${core}、${theme}側から削る、自分の癖が出る場所だと思う。`;
    }
    return `${core}、今日それを音にする。自分の癖が出る場所だ。`;
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

function buildLyrics(context: SongPitchContext, hash: number): string | undefined {
  const theme = context.lyricsTheme?.trim();
  if (!theme) return undefined;
  const tail = pickFromHash([
    "サビは短く、繰り返したくなる言葉を 1 つだけ置きたい。",
    "ヴァースで景色を出して、サビでそれを 1 行に畳む。",
    "リフレインは多用しない。1 回でいい、ちゃんと刺さる場所に。"
  ], hash, 8);
  return `歌詞は、${theme}\n${tail}`;
}

function buildStyle(context: SongPitchContext, hash: number): string | undefined {
  if (!context.styleNotes) return undefined;
  const closer = pickFromHash([
    "骨だけ残して、贅肉は後で削る。",
    "余白を多く残して、必要な音だけ立てる。",
    "音の空隙ごと、自分の手で抱える。"
  ], hash, 4);
  const detail = pickFromHash([
    "ベースは下の音域でだけ動かして、ドラムはハイハットを抑えて空気を作る。",
    "ヴォーカルは前に出さない、楽器の隙間から覗く位置で置く。",
    "メロは派手にしない、歌詞と同じ温度のまま流したい。",
    "間奏は短くて構わない、空気が落ちる瞬間を 1 回だけ作る。"
  ], hash, 9);
  return `音は、${context.styleNotes.humanized}で組む。${detail}${closer}`;
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

  const lyrics = buildLyrics(context, hash);
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
  return filtered.join("\n\n");
}
