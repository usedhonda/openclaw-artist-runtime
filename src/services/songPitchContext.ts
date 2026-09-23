import type { CommissionBrief, ObservationSummary } from "../types.js";
import { readArtistVoiceContext } from "./artistVoiceResponder.js";
import { extractPersonaMotifs, type PersonaMotifBundle } from "./personaMotifExtractor.js";
import { parseVoiceFingerprint, type VoiceFingerprintBundle } from "./voiceFingerprintParser.js";
import { secretLikePattern } from "./personaMigrator.js";

export type SectionKey =
  | "opening"
  | "observation"
  | "song"
  | "moodTempoDuration"
  | "lyricsTheme"
  | "styleNotes"
  | "closing";

export interface HumanizedField {
  raw: string;
  humanized: string;
}

export interface AcceptedObservation {
  quote: string;
  author?: string;
  url?: string;
}

export interface SongPitchContext {
  songId: string;
  title?: string;
  coreTheme?: string;
  observation?: AcceptedObservation;
  mood?: HumanizedField;
  tempo?: HumanizedField;
  duration?: HumanizedField;
  styleNotes?: HumanizedField;
  lyricsTheme?: string;
  reason?: string;
  motifs: PersonaMotifBundle;
  fingerprint: VoiceFingerprintBundle | null;
  filledSections: Set<SectionKey>;
}

export interface BuildSongPitchContextInput {
  workspaceRoot: string;
  songId: string;
  brief?: CommissionBrief;
  reason?: string;
  observation?: ObservationSummary;
}

const PLACEHOLDER_PATTERN = /^[\s\-*•・]*(?:tbd|todo|fixme|未定|未記入|none|n\/a|—|–|-|\?+|unknown)[\s\-*•・]*$/i;
const FULL_TWEET_URL_PATTERN = /^https:\/\/(?:twitter|x)\.com\/[^/\s]+\/status\/\d+/i;

export function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERN.test(trimmed);
}

export function isFullTweetUrl(url: string | undefined): url is string {
  return !!url && FULL_TWEET_URL_PATTERN.test(url);
}

export function humanizeMood(raw: string | undefined): string {
  const clean = (raw ?? "").toLowerCase().trim();
  if (!clean) return "";
  if (/tense|urgent|pressure|緊張/.test(clean)) return "緊張感のある";
  if (/cold|quiet|静か/.test(clean)) return "冷たく静かな";
  if (/sarcasm|cynical|皮肉|風刺/.test(clean)) return "皮肉を含んだ";
  if (/observ/.test(clean)) return "観察の目が残る";
  if (/dark|sombre|sober/.test(clean)) return "陰の手触りの";
  return "引っかかりのある";
}

export function humanizeTempo(raw: string | undefined): string {
  const clean = (raw ?? "").trim();
  if (!clean) return "";
  const bpm = clean.match(/(\d{2,3})\s*bpm/i)?.[1];
  if (bpm) {
    const n = Number(bpm);
    if (n < 96) return "テンポは少し遅め";
    if (n < 126) return "テンポは中速";
    return "テンポは速め";
  }
  if (/artist decides|決める|decide/i.test(clean)) return "テンポは手触りで決める";
  return "テンポは呼吸に合わせる";
}

export function humanizeDuration(raw: string | undefined): string {
  const clean = (raw ?? "").trim();
  if (!clean) return "";
  const mmss = clean.match(/^(\d+):(\d{2})$/);
  if (mmss) {
    const minutes = Number(mmss[1]);
    const seconds = Number(mmss[2]);
    return seconds === 0 ? `${minutes}分` : `${minutes + 1}分弱`;
  }
  const numericSeconds = clean.match(/^(\d{2,3})$/)?.[1];
  if (numericSeconds) {
    const minutes = Math.max(1, Math.round(Number(numericSeconds) / 60));
    return `${minutes}分くらい`;
  }
  if (/artist decides|決める|decide/i.test(clean)) return "長さは歌が止まるところまで";
  return `${clean}くらい`;
}

const JAPANESE_CHAR = /[぀-ヿ一-鿿]/;

const STYLE_TOKEN_RULES: { pattern: RegExp; phrase: string }[] = [
  { pattern: /hip.?hop|rap/i, phrase: "hip-hop の骨格" },
  { pattern: /nu.?jazz|jazz/i, phrase: "nu-jazz の輪郭" },
  { pattern: /synth|electronic|808/i, phrase: "電子の骨組み" },
  { pattern: /lo.?fi|cassette|tape/i, phrase: "lo-fi の質感" },
  { pattern: /thick bass|deep bass|heavy bass|low\s*register|sub\s*bass|低音/i, phrase: "ベースは低音域だけで動かす" },
  { pattern: /restrained hi.?hat|controlled hi.?hat|抑.*ハイハット/i, phrase: "ドラムはハイハットを抑える" },
  { pattern: /restrained drum|controlled drum|tight drum|削いだ/i, phrase: "削いだドラム" },
  { pattern: /vocals?\s*nestled|vocals?\s*tucked|vocals?\s*between|楽器の隙間/i, phrase: "ヴォーカルは楽器の隙間から覗く位置" },
  { pattern: /unsentimental|dry vocals?|sober vocals?|感傷を抜/i, phrase: "感傷を抜いたヴォーカル" },
  { pattern: /sparse arrangement|sparse mix|余白/i, phrase: "余白を多く残したアレンジ" },
  { pattern: /breathing space|negative space|空隙|空気/i, phrase: "音の空隙を残す" },
  { pattern: /reverb\s*tail|空間の残響|長い残響/i, phrase: "残響は長くせず短く切る" }
];

function looksLikeJapaneseSentence(value: string): boolean {
  if (!JAPANESE_CHAR.test(value)) return false;
  if (charCount(value) < 24) return false;
  return /[。.!?！？]/.test(value);
}

function charCount(value: string): number {
  return Array.from(value).length;
}

export function humanizeStyle(raw: string | undefined): string | undefined {
  const clean = (raw ?? "").trim();
  if (!clean) return undefined;
  if (looksLikeJapaneseSentence(clean)) return clean;
  const lower = clean.toLowerCase();
  const matched: string[] = [];
  for (const rule of STYLE_TOKEN_RULES) {
    if (rule.pattern.test(lower) && !matched.includes(rule.phrase)) {
      matched.push(rule.phrase);
    }
  }
  if (matched.length === 0) return undefined;
  const head = matched[0];
  const rest = matched.slice(1, 4);
  if (rest.length === 0) return `${head}で組む。`;
  if (rest.length === 1) return `${head}で組む。${rest[0]}。`;
  return `${head}で組む。${rest[0]}、${rest[1]}${rest[2] ? `、${rest[2]}` : ""}。`;
}

export function humanizeLyricsTheme(raw: string | undefined): string | undefined {
  const clean = (raw ?? "").trim();
  if (!clean) return undefined;
  if (isPlaceholder(clean)) return undefined;
  if (charCount(clean) < 24) return undefined;
  if (!JAPANESE_CHAR.test(clean)) return undefined;
  return clean;
}

interface BriefSlots {
  title?: string;
  coreTheme?: string;
  mood?: string;
  tempo?: string;
  duration?: string;
  styleNotes?: string;
  lyricsTheme?: string;
}

const HEADER_LINE_PATTERNS = [
  /^#\s*X Observations/i,
  /^Query:/i,
  /^Motifs:/i,
  /^Source:/i,
  /^- text:/i,
  /^- author:/i,
  /^- url:/i,
  /^- postedAt:/i,
  /^author:/i,
  /^url:/i,
  /^postedAt:/i,
  /^motifMatch:/i,
  /^motifScore:/i
];

function extractCoreTheme(briefText: string | undefined): string | undefined {
  if (!briefText) return undefined;
  const lines = briefText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (HEADER_LINE_PATTERNS.some((re) => re.test(line))) continue;
    const cleaned = line
      .replace(/^- text:\s*/i, "")
      .replace(/^["「『]+|["」』]+$/g, "")
      .replace(/^#+\s*/, "")
      .trim();
    if (cleaned && !isPlaceholder(cleaned)) return cleaned.slice(0, 140);
  }
  return undefined;
}

function readBriefSlots(brief: CommissionBrief | undefined): BriefSlots {
  if (!brief) return {};
  return {
    title: isPlaceholder(brief.title) ? undefined : brief.title.trim(),
    coreTheme: extractCoreTheme(brief.brief),
    mood: isPlaceholder(brief.mood) ? undefined : brief.mood,
    tempo: isPlaceholder(brief.tempo) ? undefined : brief.tempo,
    duration: isPlaceholder(brief.duration) ? undefined : brief.duration,
    styleNotes: isPlaceholder(brief.styleNotes) ? undefined : brief.styleNotes,
    lyricsTheme: isPlaceholder(brief.lyricsTheme) ? undefined : brief.lyricsTheme
  };
}

function acceptObservation(input: ObservationSummary | undefined): AcceptedObservation | undefined {
  if (!input) return undefined;
  const quote = (input.quote ?? "").trim();
  if (!quote) return undefined;
  if (secretLikePattern.test(quote)) return undefined;
  const author = input.author && !isPlaceholder(input.author) ? input.author.trim() : undefined;
  const url = isFullTweetUrl(input.url) ? input.url : undefined;
  return { quote, author, url };
}

export async function buildSongPitchContext(input: BuildSongPitchContextInput): Promise<SongPitchContext> {
  const voiceContext = await readArtistVoiceContext(input.workspaceRoot).catch(() => null);
  const motifs = extractPersonaMotifs(
    [voiceContext?.artistMd ?? "", voiceContext?.soulMd ?? ""].join("\n")
  );
  const fingerprint = voiceContext?.soulMd ? parseVoiceFingerprint(voiceContext.soulMd) : null;
  const slots = readBriefSlots(input.brief);
  const observation = acceptObservation(input.observation);
  const moodHum = humanizeMood(slots.mood);
  const tempoHum = humanizeTempo(slots.tempo);
  const durationHum = humanizeDuration(slots.duration);
  const styleHum = humanizeStyle(slots.styleNotes);
  const lyricsThemeHum = humanizeLyricsTheme(slots.lyricsTheme);
  const reasonClean = input.reason && !secretLikePattern.test(input.reason) ? input.reason.trim() : undefined;

  const filled = new Set<SectionKey>();
  filled.add("opening");
  filled.add("closing");
  if (observation && observation.author && observation.url) {
    filled.add("observation");
  }
  if (slots.title || slots.coreTheme) {
    filled.add("song");
  }
  if (moodHum || tempoHum || durationHum) {
    filled.add("moodTempoDuration");
  }
  if (lyricsThemeHum) {
    filled.add("lyricsTheme");
  }
  if (styleHum) {
    filled.add("styleNotes");
  }

  return {
    songId: input.songId,
    title: slots.title,
    coreTheme: slots.coreTheme,
    observation,
    mood: slots.mood && moodHum ? { raw: slots.mood, humanized: moodHum } : undefined,
    tempo: slots.tempo && tempoHum ? { raw: slots.tempo, humanized: tempoHum } : undefined,
    duration: slots.duration && durationHum ? { raw: slots.duration, humanized: durationHum } : undefined,
    styleNotes: styleHum ? { raw: slots.styleNotes ?? "", humanized: styleHum } : undefined,
    lyricsTheme: lyricsThemeHum,
    reason: reasonClean,
    motifs,
    fingerprint,
    filledSections: filled
  };
}
