// Plan v10.8: persona motif extractor.
// Reads ARTIST.md (and optionally SOUL.md) text and returns motif buckets used by
// xObservationScorer / xQueryStrategyPlanner / themeProposer to bind the
// observation -> lyric -> music chain to the artist's persona instead of falling
// back to surface-word soup.

export interface PersonaMotifBundle {
  themes: string[];
  vocabulary: string[];
  geographies: string[];
  sound: string[];
  avoid: string[];
  raw: string;
}

interface SectionHit {
  heading: string;
  body: string;
}

const sectionHeadingPattern = /^#{1,4}\s+(.+?)\s*$/;
const bulletPattern = /^[-*]\s+(.+?)\s*$/;
const cleanupPattern = /[「」『』【】（）()]/g;
const trailingPunct = /[、。,.!?！？:：;；]+$/g;
const stopWords = new Set([
  "tbd",
  "music",
  "society",
  "culture",
  "world",
  "people",
  "things",
  "thing",
  "stuff",
  "today",
  "now",
  "here",
  "there",
  "this",
  "that",
  "these",
  "those",
  "the",
  "and",
  "but",
  "or",
  "with",
  "for",
  "from",
  "into",
  "about",
  "like"
]);

const themeSeeds = [
  "社会風刺",
  "風刺",
  "皮肉",
  "ユーモア",
  "怒り",
  "権力構造",
  "矛盾",
  "再開発",
  "再開発の失敗",
  "文化の均質化",
  "均質化",
  "若者が逃げ出す",
  "若者逃出",
  "若者",
  "経営者",
  "経営者視座",
  "経営者の目",
  "ストリート",
  "地べた",
  "ビジネス",
  "俗語",
  "知的",
  "ニュース",
  "Twitter",
  "X",
  "信号",
  "観察",
  "皮肉とユーモア",
  "ハイレイヤー",
  "二面性"
];
const vocabSeeds = [
  "経営者",
  "地べた",
  "路地裏",
  "緊張感",
  "ビジネス用語",
  "俗語",
  "高速フロウ",
  "高速韻",
  "韻",
  "硬く踏む",
  "短い言葉",
  "二面性",
  "皮肉",
  "ユーモア",
  "オフィス",
  "ストリート",
  "知的",
  "ニュース",
  "観察"
];
const soundSeeds = [
  "hip-hop",
  "nu-jazz rap",
  "progressive rap",
  "ジャズドラム",
  "ブレイクビーツ",
  "高速ジャズドラム",
  "Rhodes",
  "ローズ",
  "エレピ",
  "エレベ",
  "太いエレベ",
  "ホーンセクション",
  "ホーン",
  "サックス",
  "ウッドベース",
  "120 BPM",
  "160 BPM",
  "高速フロウ",
  "中音域",
  "囁き",
  "叫び",
  "Brooklyn beat",
  "NY underground rap",
  "Manhattan jazz",
  "ジャズ",
  "ヒップホップ"
];
const geoSeeds = [
  "六本木",
  "渋谷",
  "新宿",
  "原宿",
  "新橋",
  "丸の内",
  "銀座",
  "中目黒",
  "代官山",
  "下北沢",
  "秋葉原",
  "上野",
  "浅草",
  "品川",
  "東京",
  "横浜",
  "大阪",
  "京都",
  "福岡",
  "シンガポール",
  "Brooklyn",
  "ブルックリン",
  "Manhattan",
  "マンハッタン",
  "NY",
  "New York",
  "ニューヨーク",
  "London",
  "ロンドン",
  "Berlin",
  "ベルリン",
  "Tokyo"
];
const avoidSeeds = [
  "自己紹介",
  "説明口調",
  "事実を述べる",
  "感情語連打",
  "比喩盛りすぎ",
  "抽象名詞連打",
  "generic hype",
  "hype",
  "promo",
  "プロモ",
  "stan",
  "bot",
  "ai bot",
  "buy now",
  "limited offer",
  "earn money",
  "稼げる",
  "副業",
  "fx",
  "暗号資産",
  "crypto",
  "nft",
  "投げ銭"
];

function normalize(value: string): string {
  return value
    .replace(cleanupPattern, " ")
    .replace(/\s+/g, " ")
    .replace(trailingPunct, "")
    .trim();
}

function splitSections(text: string): SectionHit[] {
  const lines = text.split(/\r?\n/);
  const sections: SectionHit[] = [];
  let current: SectionHit | undefined;
  for (const line of lines) {
    const heading = sectionHeadingPattern.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { heading: normalize(heading[1]), body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections;
}

function bulletsOf(body: string): string[] {
  const items: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const match = bulletPattern.exec(rawLine);
    if (!match) continue;
    const value = normalize(match[1]);
    if (value) items.push(value);
  }
  return items;
}

function bodyTokens(body: string): string[] {
  return body
    .split(/[\s、。,.!?！？:：;；]+/)
    .map(normalize)
    .filter((token) => token.length > 0 && !stopWords.has(token.toLowerCase()));
}

function dedupeKeepCase(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (key.length === 0) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function findSeeds(haystack: string, seeds: string[]): string[] {
  const lower = haystack.toLowerCase();
  return seeds.filter((seed) => lower.includes(seed.toLowerCase()));
}

function pickBucket(headings: string[], sections: SectionHit[]): SectionHit[] {
  const lowerHeads = headings.map((h) => h.toLowerCase());
  return sections.filter((section) =>
    lowerHeads.some((heading) => section.heading.toLowerCase().includes(heading))
  );
}

const themeHeadings = ["lyrics", "歌詞", "current artist core", "obsessions", "人物像"];
const soundHeadings = ["sound", "voice", "音楽的ルーツ", "プロダクション"];
const lyricHeadings = ["lyrics", "歌詞", "voice"];
const avoidHeadings = ["lyrics", "歌詞", "避ける", "avoid"];

function extractFromBuckets(personaText: string): PersonaMotifBundle {
  const sections = splitSections(personaText);
  const themeSections = pickBucket(themeHeadings, sections);
  const soundSections = pickBucket(soundHeadings, sections);
  const lyricSections = pickBucket(lyricHeadings, sections);
  const avoidSections = pickBucket(avoidHeadings, sections);
  const themeBody = themeSections.map((s) => s.body).join("\n");
  const soundBody = soundSections.map((s) => s.body).join("\n");
  const lyricBody = lyricSections.map((s) => s.body).join("\n");
  const avoidBody = avoidSections.map((s) => s.body).join("\n");
  const fullBody = personaText;

  const themes = dedupeKeepCase([
    ...findSeeds(themeBody, themeSeeds),
    ...bulletsOf(themeBody)
      .map(stripObsessionPrefix)
      .filter((value) => value.length > 0 && value.length <= 24)
  ]).slice(0, 16);

  const vocabulary = dedupeKeepCase([
    ...findSeeds(lyricBody, vocabSeeds),
    ...bodyTokens(lyricBody).filter((token) => /[一-龠]/.test(token) && token.length >= 2 && token.length <= 8)
  ]).slice(0, 24);

  const sound = dedupeKeepCase([
    ...findSeeds(soundBody, soundSeeds),
    ...bulletsOf(soundBody)
      .map((value) => value.replace(/^[A-Za-z぀-ゟ゠-ヿ一-龠]+:\s*/, ""))
      .filter((value) => value.length > 0 && value.length <= 32)
  ]).slice(0, 24);

  const geographies = dedupeKeepCase(findSeeds(fullBody, geoSeeds)).slice(0, 16);

  const avoid = dedupeKeepCase([
    ...findSeeds(avoidBody, avoidSeeds),
    ...findSeeds(fullBody, avoidSeeds)
  ]).slice(0, 16);

  return {
    themes,
    vocabulary,
    geographies,
    sound,
    avoid,
    raw: personaText
  };
}

function stripObsessionPrefix(value: string): string {
  return value
    .replace(/^Core obsessions[:：]\s*/i, "")
    .replace(/^Emotional weather[:：]\s*/i, "")
    .replace(/^テーマ[:：]\s*/, "")
    .replace(/^視点[:：]\s*/, "")
    .replace(/^語彙[:：]\s*/, "")
    .replace(/^韻[:：]\s*/, "")
    .trim();
}

export function extractPersonaMotifs(personaText?: string | null): PersonaMotifBundle {
  const safe = (personaText ?? "").toString();
  if (!safe.trim()) {
    return { themes: [], vocabulary: [], geographies: [], sound: [], avoid: [], raw: safe };
  }
  return extractFromBuckets(safe);
}

export function summarizeMotifs(motifs: PersonaMotifBundle): string {
  const parts: string[] = [];
  if (motifs.themes.length > 0) parts.push(`themes: ${motifs.themes.slice(0, 6).join("/")}`);
  if (motifs.geographies.length > 0) parts.push(`geo: ${motifs.geographies.slice(0, 4).join("/")}`);
  if (motifs.vocabulary.length > 0) parts.push(`vocab: ${motifs.vocabulary.slice(0, 4).join("/")}`);
  if (motifs.sound.length > 0) parts.push(`sound: ${motifs.sound.slice(0, 4).join("/")}`);
  return parts.join(" | ");
}

export function topQueryKeywords(motifs: PersonaMotifBundle, limit = 5): string[] {
  // Geo and themes give the most artist-aligned signal for X queries.
  // Avoid sound (music vocabulary) and avoid bucket entirely on the way out.
  const buckets = [
    ...motifs.geographies.map((value) => ({ value, weight: 4 })),
    ...motifs.themes.map((value) => ({ value, weight: 3 })),
    ...motifs.vocabulary.map((value) => ({ value, weight: 2 }))
  ];
  const seen = new Set<string>();
  const ranked: string[] = [];
  for (const item of buckets) {
    const key = item.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.value.length === 0 || item.value.length > 18) continue;
    ranked.push(item.value);
    if (ranked.length >= limit) break;
  }
  return ranked;
}
