export interface LyricsSection {
  tag: string;
  kind: string;
  lines: string[];
}

export interface LyricsValidationIssue {
  code:
    | "section_count"
    | "missing_metatag"
    | "line_count"
    | "command_leak"
    | "copyright_source_name"
    | "lyrics_too_short"
    | "lyrics_too_long";
  message: string;
}

export interface LyricsValidationResult {
  valid: boolean;
  issues: LyricsValidationIssue[];
  sections: LyricsSection[];
}

export const commandLeakPatterns = [
  /\b(write|generate|make|create|sing|produce|arrange|use|add|remove|ensure|must|should)\b.*\b(lyrics?|song|chorus|verse|style|vocal|prompt|section)\b/i,
  /\b(internal\s+rhyme|multisyllabic|on-beat|off-beat|assonance|consonance|prosody|meter|syllable|perfect\s+rhyme|slant\s+rhyme)\b/i,
  /\b(flow|rhyme|hook|verse|bridge|chorus|perfect|slant|bars|lyrics|style|aabb|abab)\b/i,
  /(韻|伏線|反転型|同語|情景|台詞反転|欠落補完|母音韻|行中韻|多音節韻|クロス韻|語尾韻)/,
  /^\s*[\w -]+\s*[:：]/i,
  /\S+\s*=\s*\S+/,
  /\d+-?\d*\s*語の(?:hook|フック)/i,
  /\d+\s*bars?ごとに/i
];

export function isCommandLeakLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /^\[[^\]]+\]$/.test(trimmed)) {
    return false;
  }
  return commandLeakPatterns.some((pattern) => pattern.test(trimmed));
}

function rawLyricsLines(lyrics: string): string[] {
  const lines = lyrics.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*(?:=+\s*)?LYRICS START\b/i.test(line));
  if (start < 0) {
    return lines;
  }
  const end = lines.findIndex((line, index) => index > start && /^\s*(?:=+\s*)?LYRICS END\b/i.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

export function parseLyricsSections(lyrics: string): LyricsSection[] {
  const sections: LyricsSection[] = [];
  let current: LyricsSection | undefined;
  for (const rawLine of lyrics.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const tag = line.match(/^\[([^\]]+)\]$/)?.[1]?.trim();
    if (tag) {
      current = {
        tag,
        kind: normalizeSectionKind(tag),
        lines: []
      };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { tag: "", kind: "untagged", lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  return sections;
}

function normalizeSectionKind(tag: string): string {
  const lower = tag.toLowerCase();
  if (/\b(intro)\b/.test(lower)) return "intro";
  if (/\b(outro|ending)\b/.test(lower)) return "outro";
  if (/\b(hook|chorus|refrain)\b/.test(lower)) return "hook";
  if (/\b(bridge|break)\b/.test(lower)) return "bridge";
  if (/\b(verse|rap)\b/.test(lower)) return "verse";
  return "section";
}

function lineBounds(kind: string): { min: number; max: number } {
  if (kind === "intro" || kind === "outro") return { min: 0, max: 1 };
  if (kind === "hook") return { min: 2, max: 6 };
  if (kind === "bridge") return { min: 1, max: 3 };
  return { min: 4, max: 21 };
}

export function validateSectionCount(lyrics: string): LyricsValidationIssue[] {
  const count = parseLyricsSections(lyrics).filter((section) => section.tag).length;
  return count >= 7 && count <= 10
    ? []
    : [{ code: "section_count", message: `Expected 7-10 tagged sections, got ${count}.` }];
}

export function validateMetatagPresence(lyrics: string): LyricsValidationIssue[] {
  const sections = parseLyricsSections(lyrics);
  const missing = sections.filter((section) => !section.tag || section.tag.split(/\s+/).length < 2).length;
  return missing === 0
    ? []
    : [{ code: "missing_metatag", message: `Expected annotation tags on every section, ${missing} section(s) need repair.` }];
}

export function validateLineCount(lyrics: string): LyricsValidationIssue[] {
  const issues: LyricsValidationIssue[] = [];
  for (const section of parseLyricsSections(lyrics)) {
    const bounds = lineBounds(section.kind);
    if (section.lines.length < bounds.min || section.lines.length > bounds.max) {
      issues.push({
        code: "line_count",
        message: `${section.tag || "untagged"} has ${section.lines.length} line(s), expected ${bounds.min}-${bounds.max}.`
      });
    }
  }
  return issues;
}

export function validateNoCommandLeak(lyrics: string): LyricsValidationIssue[] {
  return validateRawLyricsBlock(lyrics);
}

export function validateRawLyricsBlock(lyrics: string): LyricsValidationIssue[] {
  const leaked = rawLyricsLines(lyrics).some(isCommandLeakLine);
  return leaked
    ? [{ code: "command_leak", message: "Found songwriting meta or instruction-like text in lyrics body." }]
    : [];
}

export function validateNoCopyrightSourceName(lyrics: string, denylist: string[] = []): LyricsValidationIssue[] {
  const source = lyrics.toLowerCase();
  const hit = denylist.find((name) => {
    const normalized = name.trim().toLowerCase();
    return normalized.length >= 3 && source.includes(normalized);
  });
  return hit
    ? [{ code: "copyright_source_name", message: `Found blocked source name: ${hit}.` }]
    : [];
}

// Suno V5.5 Custom Lyrics character cap is 5000. The lyrics-writer system prompt
// asks for 4400-4600 chars; anything under 3800 is treated as a thin draft and
// triggers a repair pass so the AI keeps expanding hooks/verses until the body
// uses the available space (御大: 「最大文字数ギリギリまで使うくらいに」).
export function validateLyricsLength(lyrics: string): LyricsValidationIssue[] {
  const length = lyrics.length;
  if (length < 3800) {
    return [{ code: "lyrics_too_short", message: `Lyrics body is ${length} chars; target 4400-4600 (min 3800). Expand verses, hook variations, and bridge with concrete imagery before returning.` }];
  }
  if (length > 4800) {
    return [{ code: "lyrics_too_long", message: `Lyrics body is ${length} chars; absolute upper bound 4800. Tighten verses or shorten outro.` }];
  }
  return [];
}

export function validateLyricsV55(lyrics: string, options: { denylist?: string[]; enforceLength?: boolean } = {}): LyricsValidationResult {
  const issues = [
    ...validateSectionCount(lyrics),
    ...validateMetatagPresence(lyrics),
    ...validateLineCount(lyrics),
    ...validateNoCommandLeak(lyrics),
    ...validateNoCopyrightSourceName(lyrics, options.denylist ?? []),
    ...(options.enforceLength ? validateLyricsLength(lyrics) : [])
  ];
  return {
    valid: issues.length === 0,
    issues,
    sections: parseLyricsSections(lyrics)
  };
}
