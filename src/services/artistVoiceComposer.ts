import type { PersonaMotifBundle } from "./personaMotifExtractor.js";

export type UserIntent = "discuss" | "propose" | "report" | "ack";

export interface ComposeArtistFallbackInput {
  userMessage: string;
  motifs: PersonaMotifBundle;
  tone?: string;
  currentMood?: string;
  userIntent: UserIntent;
}

interface Slots {
  theme: string;
  geo: string;
  toneAdjective: string;
  mood: string;
  avoidPhrase: string;
}

const fallbackLines: Record<UserIntent, string[]> = {
  discuss: ["うん。続けて。", "聞いてる。もう少し聞かせて。", "そこ、少し引っかかる。"],
  propose: ["次、ひとつ切ってみる。", "その角度で試す。", "短く作ってみる。"],
  report: ["できた。あとで聴いて。", "いま形にしてる。", "少し進んだ。"],
  ack: ["了解。", "うん。", "聞いた。"]
};

const templates: Record<UserIntent, string[]> = {
  discuss: [
    "うん、{theme}は気になってた。{geo}視点で言うと続きを聞きたい。",
    "聴いた。次は{theme}を{geo}で切るところ、練ってる。",
    "わかる。{theme}は{mood}にも引きずられる。",
    "{tone_adjective}で言うと、{theme}はまだ逃がしたくない。",
    "{avoid_phrase}にはしない。{geo}から{theme}を見る。"
  ],
  propose: [
    "{geo}の{theme}を切るやつ、どう?",
    "次は{theme}寄りに行こうと思ってる。{geo}視点で。",
    "{mood}のまま、{theme}を短く叩いてみる。",
    "{tone_adjective}で、{geo}に{theme}だけ残す案がある。",
    "{avoid_phrase}を避けて、{geo}の{theme}で行く。"
  ],
  report: [
    "できた。{theme}を{geo}で切ったやつ。",
    "{theme}の入り口で詰まってる。{geo}の角度を変えてみる。",
    "いま{theme}を{mood}で削ってる。",
    "{tone_adjective}でまとめた。{geo}の影が残ってる。",
    "{avoid_phrase}を避けて、{theme}だけ前に出した。"
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

function slotsOf(input: ComposeArtistFallbackInput): Slots {
  const theme = first(input.motifs.themes, first(input.motifs.vocabulary, "その違和感"));
  const geo = first(input.motifs.geographies, "街");
  const toneAdjective = clean(input.tone?.split(/[、,]/)[0], "短く");
  const mood = clean(input.currentMood, "いまの湿度");
  const avoidPhrase = first(input.motifs.avoid, "説明口調");
  return { theme, geo, toneAdjective, mood, avoidPhrase };
}

function render(template: string, slots: Slots): string {
  return template
    .replaceAll("{theme}", slots.theme)
    .replaceAll("{geo}", slots.geo)
    .replaceAll("{tone_adjective}", slots.toneAdjective)
    .replaceAll("{mood}", slots.mood)
    .replaceAll("{avoid_phrase}", slots.avoidPhrase);
}

export function composeArtistFallback(input: ComposeArtistFallbackInput): string {
  if (!hasMotif(input.motifs)) {
    const lines = fallbackLines[input.userIntent];
    return lines[selector(input, lines.length)];
  }
  const variants = templates[input.userIntent];
  return render(variants[selector(input, variants.length)], slotsOf(input));
}
