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

// Curated kanji -> hiragana readings for the Suno registration copy only. The
// original lyrics keep their kanji; this map normalizes the singable registration
// text so Suno pronounces it correctly. Entries MUST stay ordered longest-source
// first so compounds are replaced before their component kanji (e.g. 街角 before
// 街, 利上げ before 利上). Kanji outside this map remain residual and fail-closed
// on purpose (a public artist must not ship a guessed reading). A complete
// arbitrary-kanji solution needs a morphological reader (kuromoji); that heavy
// dependency is deliberately not added here.
const SUNO_KANJI_REPAIRS: Array<[string, string]> = [
  // 3+ char compounds
  ["安全圏", "あんぜんけん"],
  ["再開発", "さいかいはつ"],
  ["路地裏", "ろじうら"],
  ["利上げ", "りあげ"],
  ["鳴り響", "なりひび"],
  ["鳴らす", "ならす"],
  // 2 char compounds
  ["拍手", "はくしゅ"],
  ["信号", "しんごう"],
  ["皮肉", "ひにく"],
  ["広告", "こうこく"],
  ["利上", "りあげ"],
  ["偶然", "ぐうぜん"],
  ["実感", "じっかん"],
  ["家賃", "やちん"],
  ["群衆", "ぐんしゅう"],
  ["現実", "げんじつ"],
  ["収益", "しゅうえき"],
  ["綺麗", "きれい"],
  ["商品", "しょうひん"],
  ["説明", "せつめい"],
  ["文化", "ぶんか"],
  ["残骸", "ざんがい"],
  ["常設", "じょうせつ"],
  ["導線", "どうせん"],
  ["街角", "まちかど"],
  ["灯り", "あかり"],
  ["鳴り", "なり"],
  ["鳴る", "なる"],
  // inflected / single kanji
  ["遅れる", "おくれる"],
  ["消える", "きえる"],
  ["消え", "きえ"],
  ["街", "まち"],
  ["芝", "しば"],
  ["窓", "まど"],
  ["名", "めい"],
  ["消", "き"],
  ["鳴", "なる"]
];

export function normalizeSunoRegistrationJapanese(lyrics: string): string {
  return normalizeAsciiNumbersToHiragana(lyrics)
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*\[[^\]]+\]\s*$/.test(line)) return line;
      return SUNO_KANJI_REPAIRS.reduce((current, [source, replacement]) => current.split(source).join(replacement), line);
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
