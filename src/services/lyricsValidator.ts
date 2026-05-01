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
    | "copyright_source_name";
  message: string;
}

export interface LyricsValidationResult {
  valid: boolean;
  issues: LyricsValidationIssue[];
  sections: LyricsSection[];
}

const commandLeakPattern = /\b(write|generate|make|create|sing|produce|arrange|use|add|remove|ensure|must|should)\b.*\b(lyrics?|song|chorus|verse|style|vocal|prompt|section)\b/i;

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
  const leaked = parseLyricsSections(lyrics).flatMap((section) => section.lines).some((line) => commandLeakPattern.test(line));
  return leaked
    ? [{ code: "command_leak", message: "Found instruction-like text outside section tags." }]
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

export function validateLyricsV55(lyrics: string, options: { denylist?: string[] } = {}): LyricsValidationResult {
  const issues = [
    ...validateSectionCount(lyrics),
    ...validateMetatagPresence(lyrics),
    ...validateLineCount(lyrics),
    ...validateNoCommandLeak(lyrics),
    ...validateNoCopyrightSourceName(lyrics, options.denylist ?? [])
  ];
  return {
    valid: issues.length === 0,
    issues,
    sections: parseLyricsSections(lyrics)
  };
}
