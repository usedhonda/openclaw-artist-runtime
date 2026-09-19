import type { AiReviewProvider, ObservationSummary } from "../types.js";
import {
  callAiProvider,
  isAiNotConfiguredResponse,
  isAiProviderMockFallbackResponse
} from "./aiProviderClient.js";
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

const TECHNIQUE_PATTERN = /(?:韻|強勢|拍|反復|パンチライン|ダブルミーニング|比喩|伏線|視点|反転|音節|母音|子音|コードスイッチ|日英|フロー|アソナンス|脚韻|内部韻)/i;
const GENERIC_COMMENTARY_PATTERN = /^(?:曲の主張を一度で残すフックにした|この短い一行へ、曲の主張を集めた|ニュースを歌詞にした|短いフックにした)[。.]?$/;

interface GeneratedSongCreationNote {
  sourceSummary?: unknown;
  artistReaction?: unknown;
  lyricConcept?: unknown;
  lyricHighlights?: unknown;
  musicIntent?: unknown;
  listenFor?: unknown;
}

export interface FormatSongCreationMessageInput {
  title: string;
  note: SongCreationNote;
  lyrics?: string;
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

function unwrapJson(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return (fenced ?? value).trim();
}

function sharesGroundingFragment(summary: string, source: string): boolean {
  const cleanSummary = summary.replace(/\s+/g, "");
  const cleanSource = source.replace(/\s+/g, "");
  if (!cleanSource) return true;
  for (let index = 0; index <= cleanSource.length - 3; index += 1) {
    const fragment = cleanSource.slice(index, index + 3);
    if (/^[\p{P}\p{S}]+$/u.test(fragment)) continue;
    if (cleanSummary.includes(fragment)) return true;
  }
  return false;
}

export function isGroundedSongCreationNote(note: SongCreationNote, lyrics: string): boolean {
  if (!note.artistReaction || note.artistReaction.length < 80) return false;
  if (!note.lyricConcept || note.lyricConcept.length < 80) return false;
  if (!note.musicIntent || note.musicIntent.length < 60) return false;
  if (note.lyricHighlights.length < 2 || note.listenFor.length < 2) return false;
  return note.lyricHighlights.every((highlight) => {
    const quote = highlight.quote.split(" / ")[0]?.trim() ?? "";
    return quote.length > 0
      && lyrics.includes(quote)
      && TECHNIQUE_PATTERN.test(highlight.explanation)
      && !GENERIC_COMMENTARY_PATTERN.test(highlight.explanation.trim());
  });
}

export function parseGeneratedSongCreationNote(raw: string, input: BuildSongCreationNoteInput): SongCreationNote | undefined {
  let generated: GeneratedSongCreationNote;
  try {
    generated = JSON.parse(unwrapJson(raw)) as GeneratedSongCreationNote;
  } catch {
    return undefined;
  }
  const sourceSummary = publicText(typeof generated.sourceSummary === "string" ? generated.sourceSummary : undefined, 360);
  const artistReaction = publicText(typeof generated.artistReaction === "string" ? generated.artistReaction : undefined, 700);
  const lyricConcept = publicText(typeof generated.lyricConcept === "string" ? generated.lyricConcept : undefined, 700);
  const musicIntent = publicText(typeof generated.musicIntent === "string" ? generated.musicIntent : undefined, 600);
  const rawHighlights = Array.isArray(generated.lyricHighlights) ? generated.lyricHighlights : [];
  const lyricHighlights = rawHighlights.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as { quote?: unknown; explanation?: unknown };
    const quote = publicText(typeof value.quote === "string" ? value.quote : undefined, 180);
    const explanation = publicText(typeof value.explanation === "string" ? value.explanation : undefined, 420);
    if (!quote || !explanation || !input.lyrics.includes(quote) || !TECHNIQUE_PATTERN.test(explanation)
      || GENERIC_COMMENTARY_PATTERN.test(explanation)) return [];
    return [{ quote, explanation }];
  }).slice(0, 3);
  const listenFor = (Array.isArray(generated.listenFor) ? generated.listenFor : [])
    .flatMap((item) => typeof item === "string" ? [publicText(item, 240)] : [])
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
  if (input.observation?.quote && (!sourceSummary || !sharesGroundingFragment(sourceSummary, input.observation.quote))) return undefined;
  if (!artistReaction || !lyricConcept || !musicIntent) return undefined;
  const note: SongCreationNote = {
    version: 1,
    source: {
      author: compact(input.observation?.author, 100),
      url: compact(input.observation?.url, 1000),
      summary: sourceSummary
    },
    artistReaction,
    lyricConcept,
    lyricHighlights,
    musicIntent,
    listenFor
  };
  return isGroundedSongCreationNote(note, input.lyrics) ? note : undefined;
}

export function buildSongCreationNotePrompt(input: BuildSongCreationNoteInput): string {
  return [
    "あなたは、この曲を書いたアーティスト本人として制作ノートを書く。報告書や宣伝文ではなく、一人称の具体的な制作判断を書くこと。",
    "ニュース、感情、歌詞、技法、音の因果を通す。ARTIST.md等の人物設定をなぞらず、この曲の実素材だけを根拠にする。",
    "次のJSONだけを返す。観測がある場合、sourceSummaryは採用した一件だけ。観測がなければsourceSummaryは空文字にする。lyricHighlightsは歌詞に完全一致する引用を2〜3件使い、韻・内部韻・反復・強勢・比喩・伏線・視点反転等の実在する技法と聴感上の効果を書く。",
    '{"sourceSummary":"2文以内","artistReaction":"2〜4文。引っかかり、個人的な理由、未解決の疑問","lyricConcept":"2〜4文。出来事を何へ変換し、なぜ直接説明しなかったか","lyricHighlights":[{"quote":"歌詞の完全一致引用","explanation":"技法名と効果"}],"musicIntent":"2〜3文。音の選択と歌詞への効果","listenFor":["具体的な聴きどころ"]}',
    `観測本文: ${input.observation?.quote ?? "なし"}`,
    `観測者: ${input.observation?.author ?? "不明"}`,
    `アーティストが曲を作る理由: ${input.artistReason ?? "なし"}`,
    `Style:\n${input.style.slice(0, 1800)}`,
    `最終歌詞:\n${input.lyrics.slice(0, 7000)}`
  ].join("\n\n");
}

export async function composeSongCreationNote(
  input: BuildSongCreationNoteInput,
  provider: AiReviewProvider | undefined
): Promise<SongCreationNote> {
  const fallback = buildSongCreationNote(input);
  if (!provider || provider === "mock") return fallback;
  try {
    const raw = await callAiProvider(buildSongCreationNotePrompt(input), { provider, reasoningEffort: "high", timeoutMs: 120000 });
    if (isAiNotConfiguredResponse(raw) || isAiProviderMockFallbackResponse(raw)) return fallback;
    return parseGeneratedSongCreationNote(raw, input) ?? fallback;
  } catch {
    return fallback;
  }
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
    artistReaction: typeof note.artistReaction === "string" ? publicText(note.artistReaction, 700) : undefined,
    lyricConcept: typeof note.lyricConcept === "string" && !secretLikePattern.test(note.lyricConcept) ? compact(note.lyricConcept, 700) : undefined,
    lyricHighlights: highlights,
    musicIntent: typeof note.musicIntent === "string" && !secretLikePattern.test(note.musicIntent) ? compact(note.musicIntent, 600) : undefined,
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
  const grounded = input.lyrics === undefined || isGroundedSongCreationNote(input.note, input.lyrics);
  return [
    `🎵 「${title}」ができた。`,
    sourceLines.length > 0 ? `\nきっかけになったニュース\n${sourceLines.join("\n")}` : undefined,
    input.note.source.summary ? `\nニュースの概要\n${input.note.source.summary}` : undefined,
    !grounded ? "\n制作ノート\n制作意図の文章化に失敗した。薄い定型文では代用しない。" : undefined,
    !grounded && input.note.lyricHighlights.length > 0
      ? `\n確認できた歌詞\n${input.note.lyricHighlights.map((highlight) => `・「${highlight.quote}」`).join("\n")}`
      : undefined,
    !grounded && input.note.musicIntent ? `\n確認できた音の情報\n${input.note.musicIntent}` : undefined,
    !grounded && listenFor.length > 0 ? `\n確認事項\n${listenFor.join("\n")}` : undefined,
    grounded && input.note.artistReaction ? `\n俺が思ったこと\n${input.note.artistReaction}` : undefined,
    grounded && input.note.lyricConcept ? `\n歌詞へどう変えたか\n${input.note.lyricConcept}` : undefined,
    grounded && highlightLines.length > 0 ? `\n歌詞のテクニカルな要所\n${highlightLines.join("\n\n")}` : undefined,
    grounded && input.note.musicIntent ? `\n音へどう変えたか\n${input.note.musicIntent}` : undefined,
    grounded && listenFor.length > 0 ? `\n聴いてほしいところ\n${listenFor.join("\n")}` : undefined,
    input.audioUrls.length > 0 ? `\n🎧 聴く\n${numberedLinks(input.audioUrls).join("\n")}` : undefined,
    input.previousAudioUrls && input.previousAudioUrls.length > 0
      ? `\n前の音源\n${numberedLinks(input.previousAudioUrls).join("\n")}`
      : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");
}
