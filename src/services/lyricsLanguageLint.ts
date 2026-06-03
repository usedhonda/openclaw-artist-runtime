export interface LyricsLanguageWarning {
  token: string;
  line: number;
  kind?: "english_fragment" | "residual_kanji" | "ascii_number";
}

export function lintJapaneseLyricsEnglishFragments(lyrics: string): LyricsLanguageWarning[] {
  const warnings: LyricsLanguageWarning[] = [];
  const lines = lyrics.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) return;
    const matches = line.matchAll(/\b[A-Za-z]{4,}\b/g);
    for (const match of matches) {
      warnings.push({ token: match[0], line: index + 1 });
    }
  });
  return warnings;
}

const DIGIT_WORDS = ["ぜろ", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"] as const;

export function asciiNumberToHiragana(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw new Error(`unsupported_ascii_number:${value}`);
  }
  if (value < 10) return DIGIT_WORDS[value] ?? "";
  if (value === 10) return "じゅう";
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  const prefix = tens === 1 ? "" : DIGIT_WORDS[tens];
  return `${prefix}じゅう${ones === 0 ? "" : DIGIT_WORDS[ones]}`;
}

export function normalizeAsciiNumbersToHiragana(lyrics: string): string {
  return lyrics
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*\[[^\]]+\]\s*$/.test(line)) return line;
      return line.replace(/\b\d{1,2}\b/g, (token) => asciiNumberToHiragana(Number.parseInt(token, 10)));
    })
    .join("\n");
}

export function lintResidualKanji(lyrics: string): LyricsLanguageWarning[] {
  const warnings: LyricsLanguageWarning[] = [];
  const lines = lyrics.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) return;
    for (const match of line.matchAll(/[\u3400-\u9FFF\u3005]+/g)) {
      warnings.push({ token: match[0], line: index + 1, kind: "residual_kanji" });
    }
    for (const match of line.matchAll(/\b\d+\b/g)) {
      warnings.push({ token: match[0], line: index + 1, kind: "ascii_number" });
    }
  });
  return warnings;
}
