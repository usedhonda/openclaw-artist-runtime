export interface LyricsLanguagePolicy {
  mode: "ja" | "en" | "bilingual";
  japanesePercent: number;
  englishPercent: number;
  yamlLanguage: string;
  instruction: string;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function firstPercent(source: string, labels: RegExp[]): number | undefined {
  for (const label of labels) {
    const match = source.match(label);
    if (match?.[1]) {
      return clampPercent(Number.parseInt(match[1], 10));
    }
  }
  return undefined;
}

export function parseLyricsLanguagePolicy(source: string): LyricsLanguagePolicy {
  const japanese = firstPercent(source, [
    /(?:日本語|Japanese|ja)\s*[:：]?\s*(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s*(?:日本語|Japanese|ja)/i
  ]);
  const english = firstPercent(source, [
    /(?:英語|English|en)\s*[:：]?\s*(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s*(?:英語|English|en)/i
  ]);
  const japanesePercent = japanese ?? (english !== undefined ? 100 - english : 100);
  const englishPercent = english ?? (japanese !== undefined ? 100 - japanese : 0);
  const mode = englishPercent >= 70 ? "en" : englishPercent > 0 ? "bilingual" : "ja";
  const yamlLanguage = mode === "en"
    ? "English"
    : mode === "bilingual"
      ? `Japanese ${japanesePercent}% / English ${englishPercent}%`
      : "Japanese";
  const instruction = mode === "bilingual"
    ? `Language ratio is a hard constraint: about ${japanesePercent}% Japanese and ${englishPercent}% English. Keep Japanese as hiragana where required; place English in hooks, short refrains, or section-boundary code switches rather than random filler.`
    : mode === "en"
      ? "Language mode is English: write the lyric body in English only, with natural stress-based prosody."
      : "Language mode is Japanese: write the lyric body primarily in Japanese hiragana, with no casual English filler.";
  return {
    mode,
    japanesePercent,
    englishPercent,
    yamlLanguage,
    instruction
  };
}
