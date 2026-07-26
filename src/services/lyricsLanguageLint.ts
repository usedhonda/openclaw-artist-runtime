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

// Positional Japanese readings with the standard sound changes (rendaku /
// gemination) so numbers are sung the way a Japanese listener expects.
const HUNDREDS_WORDS = ["", "ひゃく", "にひゃく", "さんびゃく", "よんひゃく", "ごひゃく", "ろっぴゃく", "ななひゃく", "はっぴゃく", "きゅうひゃく"] as const;
const THOUSANDS_WORDS = ["", "せん", "にせん", "さんぜん", "よんせん", "ごせん", "ろくせん", "ななせん", "はっせん", "きゅうせん"] as const;

function tensReading(tens: number): string {
  if (tens === 0) return "";
  const prefix = tens === 1 ? "" : DIGIT_WORDS[tens];
  return `${prefix}じゅう`;
}

// Deterministic positional reading for 0-9999 (145 -> ひゃくよんじゅうご). The
// range covers years and measurements that show up in lyrics; numbers >= 10000
// have no compact singable reading, so callers fall back to digit-by-digit.
export function asciiNumberToHiragana(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 9999) {
    throw new Error(`unsupported_ascii_number:${value}`);
  }
  if (value === 0) return DIGIT_WORDS[0];
  const thousands = Math.floor(value / 1000);
  const hundreds = Math.floor((value % 1000) / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;
  const parts = [
    THOUSANDS_WORDS[thousands],
    HUNDREDS_WORDS[hundreds],
    tensReading(tens),
    ones === 0 ? "" : DIGIT_WORDS[ones]
  ];
  return parts.join("");
}

// Numbers >= 10000 stay rare in lyrics and have no compact singable reading, so
// we read them digit by digit (12345 -> いちにさんよんご) rather than throw.
function digitsToHiragana(token: string): string {
  return token
    .split("")
    .map((digit) => DIGIT_WORDS[Number.parseInt(digit, 10)] ?? "")
    .join("");
}

export function normalizeAsciiNumbersToHiragana(lyrics: string): string {
  return lyrics
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*\[[^\]]+\]\s*$/.test(line)) return line;
      return line.replace(/\d+/g, (token) => {
        const value = Number.parseInt(token, 10);
        return value <= 9999 ? asciiNumberToHiragana(value) : digitsToHiragana(token);
      });
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
  ["売れる", "うれる"],
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
  ["売買", "ばいばい"],
  ["売る", "うる"],
  ["売り", "うり"],
  // inflected / single kanji
  ["遅れる", "おくれる"],
  ["消える", "きえる"],
  ["消え", "きえ"],
  ["街", "まち"],
  ["芝", "しば"],
  ["窓", "まど"],
  ["名", "めい"],
  ["消", "き"],
  ["鳴", "なる"],
  ["売", "うり"]
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
