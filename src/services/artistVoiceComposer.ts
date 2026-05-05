import type { PersonaMotifBundle } from "./personaMotifExtractor.js";
import type { VoiceFingerprintBundle } from "./voiceFingerprintParser.js";

export type UserIntent = "discuss" | "propose" | "report" | "ack";

export interface ComposeArtistFallbackInput {
  userMessage: string;
  motifs: PersonaMotifBundle;
  tone?: string;
  currentMood?: string;
  userIntent: UserIntent;
  voiceFingerprint?: VoiceFingerprintBundle;
  lastEndings?: string[];
}

interface Slots {
  theme: string;
  geo: string;
  toneAdjective: string;
  mood: string;
  avoidPhrase: string;
  producerCallname: string;
  firstPerson: string;
  signatureMove: string;
  reaction: string;
}

const fallbackLines: Record<UserIntent, string[]> = {
  discuss: ["うん。続けて。", "聞いてる。もう少し聞かせて。", "そこ、少し引っかかる。"],
  propose: ["次、ひとつ切ってみる。", "その角度で試す。", "短く作ってみる。"],
  report: ["できた。あとで聴いて。", "いま形にしてる。", "少し進んだ。"],
  ack: ["了解。", "うん。", "聞いた。"]
};

const templates: Record<UserIntent, string[]> = {
  discuss: [
    "{reaction}、{theme}は気になってた。{geo}視点で言うと続きを聞きたい。",
    "聴いた。次は{theme}を{geo}で切るところ、練ってる。",
    "{reaction}。{geo}で見ると、{theme}は{mood}にも引きずられる。",
    "{tone_adjective}で言うと、{theme}はまだ逃がしたくない。",
    "{avoid_phrase}にはしない。{geo}から{theme}を見る。",
    "{signature_move}。{theme}の話なら、{geo}の角度で聞きたい。"
  ],
  propose: [
    "{producer_callname}、{geo}の{theme}を切るやつ、どう?",
    "次は{theme}寄りに行こうと思ってる。{geo}視点で。",
    "{mood}のまま、{theme}を短く叩いてみる。",
    "{tone_adjective}で、{geo}に{theme}だけ残す案がある。",
    "{avoid_phrase}を避けて、{geo}の{theme}で行く。",
    "{first_person}は{signature_move}の感じで、{theme}を{geo}に置きたい。"
  ],
  report: [
    "{producer_callname}、できた。{theme}を{geo}で切ったやつ。",
    "{theme}の入り口で詰まってる。{geo}の角度を変えてみる。",
    "いま{theme}を{mood}で削ってる。",
    "{tone_adjective}でまとめた。{geo}の影が残ってる。",
    "{avoid_phrase}を避けて、{theme}だけ前に出した。",
    "{signature_move}。その感じで{theme}を鳴らした。"
  ],
  ack: ["了解。", "うん。", "聞いた。", "任せて。"]
};

function clean(value: string | undefined, fallback: string): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text || /^tbd$/i.test(text)) return fallback;
  return text.replace(/[。.!?！？]+$/g, "");
}

function first(values: string[], fallback: string): string {
  return clean(values.find((value) => value.trim().length > 0), fallback);
}

function hasMotif(motifs: PersonaMotifBundle): boolean {
  return motifs.themes.length + motifs.geographies.length + motifs.vocabulary.length + motifs.sound.length > 0;
}

function selector(input: ComposeArtistFallbackInput, count: number): number {
  const firstCode = input.userMessage.codePointAt(0) ?? 0;
  return Math.abs(input.userMessage.length + firstCode + input.userIntent.length) % count;
}

function firstFingerprint(values: string[] | undefined, fallback: string): string {
  return clean(values?.find((value) => value.trim().length > 0), fallback);
}

function compactSignatureMove(value: string | undefined, fallback: string): string {
  const text = clean(value, fallback);
  const firstSentence = text.split(/[。.!?！？]/)[0]?.trim() || text;
  return firstSentence.length > 28 ? `${firstSentence.slice(0, 28)}…` : firstSentence;
}

function slotsOf(input: ComposeArtistFallbackInput): Slots {
  const voice = input.voiceFingerprint;
  const theme = first(input.motifs.themes, first(input.motifs.vocabulary, "その違和感"));
  const geo = first(input.motifs.geographies, "街");
  const toneAdjective = clean(input.tone?.split(/[、,]/)[0], "短く");
  const mood = clean(input.currentMood, "いまの湿度");
  const avoidPhrase = first(input.motifs.avoid, "説明口調");
  const producerCallname = clean(voice?.producerCallname ?? undefined, "");
  const firstPerson = clean(voice?.firstPerson ?? undefined, "俺");
  const signatureMove = compactSignatureMove(voice?.signatureMoves[0], "少し引っかかるところから始める");
  const reaction = firstFingerprint(voice?.reactionPhrases, "うん");
  return { theme, geo, toneAdjective, mood, avoidPhrase, producerCallname, firstPerson, signatureMove, reaction };
}

function render(template: string, slots: Slots): string {
  return template
    .replaceAll("{theme}", slots.theme)
    .replaceAll("{geo}", slots.geo)
    .replaceAll("{tone_adjective}", slots.toneAdjective)
    .replaceAll("{mood}", slots.mood)
    .replaceAll("{avoid_phrase}", slots.avoidPhrase)
    .replaceAll("{producer_callname}", slots.producerCallname)
    .replaceAll("{first_person}", slots.firstPerson)
    .replaceAll("{signature_move}", slots.signatureMove)
    .replaceAll("{reaction}", slots.reaction)
    .replace(/^[、,\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function forbiddenHit(text: string, voice: VoiceFingerprintBundle | undefined): boolean {
  return (voice?.forbiddenPhrases ?? []).some((phrase) => phrase.trim().length > 0 && text.includes(phrase.trim()));
}

function chooseEnding(input: ComposeArtistFallbackInput, baseIndex: number): string | null {
  const endings = input.voiceFingerprint?.sentenceEndings.filter((ending) => ending.trim().length > 0) ?? [];
  if (endings.length === 0) return null;
  const recent = new Set((input.lastEndings ?? []).slice(-5).map((ending) => ending.trim()).filter(Boolean));
  for (let offset = 0; offset < endings.length; offset += 1) {
    const ending = endings[(baseIndex + offset) % endings.length].trim();
    if (!recent.has(ending)) return ending;
  }
  return endings[baseIndex % endings.length].trim();
}

function applyEnding(text: string, ending: string | null): string {
  if (!ending) return text;
  const trimmed = text.trim();
  if (trimmed.endsWith(ending)) return trimmed;
  if (trimmed.length <= 10) return trimmed;
  const stripped = trimmed.replace(/[。.!?！？]+$/g, "");
  return `${stripped}${ending}`;
}

function selectRendered(input: ComposeArtistFallbackInput, variants: string[]): string {
  const slots = slotsOf(input);
  const start = selector(input, variants.length);
  for (let offset = 0; offset < variants.length; offset += 1) {
    const index = (start + offset) % variants.length;
    const rendered = applyEnding(render(variants[index], slots), chooseEnding(input, index + offset));
    if (!forbiddenHit(rendered, input.voiceFingerprint)) return rendered;
  }
  const rendered = applyEnding(render(variants[start], slots), chooseEnding(input, start));
  return forbiddenHit(rendered, input.voiceFingerprint) ? fallbackLines[input.userIntent][0] : rendered;
}

export function composeArtistFallback(input: ComposeArtistFallbackInput): string {
  if (!hasMotif(input.motifs)) {
    const lines = fallbackLines[input.userIntent];
    return selectRendered(input, lines);
  }
  const variants = templates[input.userIntent];
  return selectRendered(input, variants);
}
