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

export function humanizeStyle(raw: string | undefined): string | undefined {
  const clean = (raw ?? "").toLowerCase().trim();
  if (!clean) return undefined;
  if (/thick bass|deep bass|低音/.test(clean)) return "厚い低音";
  if (/restrained drum|controlled drum|抑制/.test(clean)) return "削いだドラム";
  if (/unsentimental|dry|sober/.test(clean)) return "感傷を抜いたヴォーカル";
  if (/nu.?jazz|jazz/.test(clean)) return "nu-jazz の輪郭";
  if (/hip.?hop|rap/.test(clean)) return "hip-hop の骨格";
  if (/synth|electronic/.test(clean)) return "電子の骨組み";
  return undefined;
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

function readBriefSlots(brief: CommissionBrief | undefined): BriefSlots {
  if (!brief) return {};
  const coreCandidate = (brief.brief ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return {
    title: isPlaceholder(brief.title) ? undefined : brief.title.trim(),
    coreTheme: isPlaceholder(coreCandidate) ? undefined : coreCandidate?.slice(0, 140),
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
  if (slots.lyricsTheme) {
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
    lyricsTheme: slots.lyricsTheme,
    reason: reasonClean,
    motifs,
    fingerprint,
    filledSections: filled
  };
}
