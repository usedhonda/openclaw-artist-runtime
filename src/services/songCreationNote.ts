import type { ObservationSummary } from "../types.js";
import { parseLyricsSections } from "./lyricsValidator.js";
import { secretLikePattern } from "./personaMigrator.js";

export interface SongCreationNoteHighlight {
  quote: string;
  explanation: string;
}

export interface SongCreationNote {
  version: 1;
  source: {
    author?: string;
    url?: string;
    summary?: string;
  };
  artistReaction?: string;
  lyricConcept?: string;
  lyricHighlights: SongCreationNoteHighlight[];
  musicIntent?: string;
  listenFor: string[];
}

export interface BuildSongCreationNoteInput {
  lyrics: string;
  style: string;
  briefText?: string;
  artistReason?: string;
  observation?: ObservationSummary;
}

export interface FormatSongCreationMessageInput {
  title: string;
  note: SongCreationNote;
  audioUrls: readonly string[];
  previousAudioUrls?: readonly string[];
}

function compact(value: string | undefined, max = 220): string | undefined {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return Array.from(clean).slice(0, max).join("");
}

function publicText(value: string | undefined, max: number): string | undefined {
  const clean = compact(value, max)?.replace(/@[A-Za-z0-9_]{1,20}/g, "[handle]");
  return clean && !secretLikePattern.test(clean) ? clean : undefined;
}

function briefField(briefText: string | undefined, label: string): string | undefined {
  return compact(briefText?.match(new RegExp(`^- ${label}:\\s*(.+)$`, "mi"))?.[1]);
}

function safeReaction(input: BuildSongCreationNoteInput): string | undefined {
  const candidates = [
    input.observation?.motivation,
    briefField(input.briefText, "Artist reason"),
    input.artistReason
  ];
  return candidates
    .map((value) => publicText(value, 260))
    .find((value) => value && !/(?:ARTIST|SOUL|CURRENT_STATE)\.md|autopilot|prompt pack|runtime/i.test(value));
}

function firstLine(lines: readonly string[] | undefined): string | undefined {
  return compact(lines?.find((line) => line.trim()), 120);
}

function styleIntent(style: string): string | undefined {
  const bpm = style.match(/\b(\d{2,3})\s*BPM\b/i)?.[1];
  const descriptors: string[] = [];
  const mappings: Array<[RegExp, string]> = [
    [/\bdry\b/i, "乾いた質感"],
    [/\b(?:clipped|tight) drums?\b/i, "短く切ったドラム"],
    [/\bdusty Rhodes\b|\bRhodes\b/i, "少しくすんだローズピアノ"],
    [/\bupright bass\b/i, "ウッドベース"],
    [/\bsparse\b|\bminimal\b/i, "余白を残した編成"],
    [/\ba cappella\b/i, "声だけが残る終わり方"],
    [/\bspoken(?:-word)?\b/i, "話すような声の置き方"],
    [/\bgritty\b|\braw\b/i, "ざらついた音像"],
    [/\bdistorted guitar\b/i, "歪んだギター"],
    [/\bsub[- ]bass\b/i, "低く沈むサブベース"]
  ];
  for (const [pattern, label] of mappings) {
    if (pattern.test(style) && !descriptors.includes(label)) descriptors.push(label);
  }
  const parts = [bpm ? `${bpm} BPM` : undefined, ...descriptors.slice(0, 4)].filter(Boolean);
  if (parts.length === 0) return undefined;
  return `${parts.join("、")}で、歌詞の言葉が埋もれず前に出る曲にした。`;
}

export function buildSongCreationNote(input: BuildSongCreationNoteInput): SongCreationNote {
  const sections = parseLyricsSections(input.lyrics);
  const opening = sections.find((section) => section.kind === "intro" && section.lines.length > 0)
    ?? sections.find((section) => section.kind === "verse" && section.lines.length > 0)
    ?? sections.find((section) => section.lines.length > 0);
  const hook = sections.find((section) => section.kind === "hook" && !/\bpre[- ]?hook\b/i.test(section.tag) && section.lines.length > 0);
  const bridge = sections.find((section) => section.kind === "bridge" && section.lines.length > 0);
  const verses = sections.filter((section) => section.kind === "verse" && section.lines.length > 0);
  const turn = bridge ?? verses.at(-1);
  const openingLine = firstLine(opening?.lines);
  const hookLines = (hook?.lines ?? []).map((line) => compact(line, 100)).filter((line): line is string => Boolean(line)).slice(0, 2);
  const turnLine = firstLine(turn?.lines);
  const highlights: SongCreationNoteHighlight[] = [];
  if (hookLines.length > 0) {
    highlights.push({
      quote: hookLines.join(" / "),
      explanation: hookLines.length > 1
        ? "短い言葉をぶつけ合い、曲の主張を一度で残すフックにした。"
        : "この短い一行へ、曲の主張を集めた。"
    });
  }
  if (openingLine && !hookLines.includes(openingLine)) {
    highlights.push({ quote: openingLine, explanation: "説明から入らず、最初の情景と違和感を一行で置いた。" });
  }
  if (turnLine && turnLine !== openingLine && !hookLines.includes(turnLine)) {
    highlights.push({ quote: turnLine, explanation: "後半で視点をずらし、前半の言葉を別の角度から返す転換点にした。" });
  }
  const lyricBody = input.lyrics
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[[^\]]+\]\s*$/.test(line))
    .join("\n");
  const bilingual = /[A-Za-z]/.test(lyricBody) && /[ぁ-んァ-ヶ一-龠]/.test(lyricBody);
  if (bilingual && highlights.length > 0) {
    highlights[0] = {
      ...highlights[0]!,
      explanation: `${highlights[0]!.explanation.replace(/。$/, "")}。英語の短句と日本語の核心を役割ごとに切り替えている。`
    };
  }
  const summary = publicText(input.observation?.quote, 240);
  const reaction = safeReaction(input) ?? (summary ? `俺が引っかかったのは「${summary}」だった。` : undefined);
  const lyricConcept = hookLines.length > 0
    ? `${summary ? `ニュースに残った「${summary}」を` : "元になった出来事を"}、${hookLines.map((line) => `「${line}」`).join("と")}へ変えて、曲の中心に置いた。`
    : openingLine
      ? `元になった出来事を「${openingLine}」という最初の情景へ置き換えた。`
      : undefined;
  return {
    version: 1,
    source: {
      author: compact(input.observation?.author, 100),
      url: compact(input.observation?.url, 1000),
      summary
    },
    artistReaction: reaction,
    lyricConcept,
    lyricHighlights: highlights.slice(0, 3),
    musicIntent: styleIntent(input.style),
    listenFor: [
      hookLines.length > 0 ? `フックの「${hookLines.join(" / ")}」がどう残るか。` : undefined,
      turnLine && turnLine !== openingLine ? `「${turnLine}」で視点が切り替わるところ。` : undefined
    ].filter((line): line is string => Boolean(line))
  };
}

export function parseSongCreationNote(value: unknown, lyrics: string): SongCreationNote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const note = value as Partial<SongCreationNote>;
  if (note.version !== 1 || !Array.isArray(note.lyricHighlights) || !Array.isArray(note.listenFor)) return undefined;
  const highlights = note.lyricHighlights.filter((item): item is SongCreationNoteHighlight => Boolean(
    item
      && typeof item.quote === "string"
      && typeof item.explanation === "string"
      && !secretLikePattern.test(item.quote)
      && !secretLikePattern.test(item.explanation)
      && lyrics.includes(item.quote.split(" / ")[0]!.trim())
  ));
  const source = note.source && typeof note.source === "object" ? note.source : {};
  return {
    version: 1,
    source: {
      author: typeof source.author === "string" ? compact(source.author, 100) : undefined,
      url: typeof source.url === "string" ? compact(source.url, 1000) : undefined,
      summary: typeof source.summary === "string" ? publicText(source.summary, 240) : undefined
    },
    artistReaction: typeof note.artistReaction === "string" ? publicText(note.artistReaction, 260) : undefined,
    lyricConcept: typeof note.lyricConcept === "string" && !secretLikePattern.test(note.lyricConcept) ? compact(note.lyricConcept, 420) : undefined,
    lyricHighlights: highlights,
    musicIntent: typeof note.musicIntent === "string" && !secretLikePattern.test(note.musicIntent) ? compact(note.musicIntent, 320) : undefined,
    listenFor: note.listenFor.filter((line): line is string => typeof line === "string" && !secretLikePattern.test(line))
  };
}

function numberedLinks(urls: readonly string[]): string[] {
  return urls.map((url, index) => `${index + 1}. ${url.trim()}`).filter((line) => !line.endsWith(". "));
}

export function formatSongCreationMessage(input: FormatSongCreationMessageInput): string {
  const title = input.title.trim() || "無題の曲";
  const sourceLines = [input.note.source.author, input.note.source.url].filter((line): line is string => Boolean(line?.trim()));
  const highlightLines = input.note.lyricHighlights.flatMap((highlight) => [
    `・「${highlight.quote}」`,
    `  ${highlight.explanation}`
  ]);
  const listenFor = input.note.listenFor.map((line) => `・${line}`);
  return [
    `🎵 「${title}」ができた。`,
    sourceLines.length > 0 ? `\nきっかけになったニュース\n${sourceLines.join("\n")}` : undefined,
    input.note.source.summary ? `\nニュースの概要\n${input.note.source.summary}` : undefined,
    input.note.artistReaction ? `\n俺が思ったこと\n${input.note.artistReaction}` : undefined,
    input.note.lyricConcept ? `\n歌詞にどう入れたか\n${input.note.lyricConcept}` : undefined,
    highlightLines.length > 0 ? `\n歌詞のテクニカルな要所\n${highlightLines.join("\n")}` : undefined,
    input.note.musicIntent ? `\nそして、曲へ\n${input.note.musicIntent}` : undefined,
    listenFor.length > 0 ? `\n聴いてほしいところ\n${listenFor.join("\n")}` : undefined,
    input.audioUrls.length > 0 ? `\n🎧 聴く\n${numberedLinks(input.audioUrls).join("\n")}` : undefined,
    input.previousAudioUrls && input.previousAudioUrls.length > 0
      ? `\n前の音源\n${numberedLinks(input.previousAudioUrls).join("\n")}`
      : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");
}
