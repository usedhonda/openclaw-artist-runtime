import { isCommandLeakLine, parseLyricsSections } from "./lyricsValidator.js";

const defaultTags = [
  "Intro - sparse image",
  "Verse 1 - tight flow",
  "Hook - repeated anchor",
  "Verse 2 - detail turn",
  "Bridge - contrast",
  "Verse 3 - consequence",
  "Hook - final anchor",
  "Outro - hard stop"
];

function formatSection(tag: string, lines: string[]): string {
  return [`[${tag}]`, ...lines].join("\n");
}

function sanitizeSectionTag(tag: string): string {
  const withoutNote = tag.replace(/\s*,?\s*note\s*[:：].*$/i, "").trim();
  return withoutNote || "Verse - repaired section";
}

export function repairMissingMetatags(lyrics: string): string {
  const sections = parseLyricsSections(lyrics);
  if (sections.length === 0) {
    return lyrics;
  }
  if (sections.length === 1 && !sections[0].tag && sections[0].lines.length >= 16) {
    const lines = sections[0].lines;
    const chunks = [
      lines.slice(0, 1),
      lines.slice(1, 5),
      lines.slice(5, 8),
      lines.slice(8, 12),
      lines.slice(12, 14),
      lines.slice(14, 18),
      lines.slice(18, 21),
      lines.slice(21, 22)
    ];
    return chunks
      .map((chunk, index) => formatSection(defaultTags[index], chunk))
      .join("\n\n");
  }
  return sections
    .map((section, index) => {
      const tag = section.tag && section.tag.split(/\s+/).length >= 2
        ? section.tag
        : defaultTags[Math.min(index, defaultTags.length - 1)];
      return formatSection(tag, section.lines);
    })
    .join("\n\n");
}

function bounds(tag: string): { min: number; max: number } {
  const lower = tag.toLowerCase();
  if (/\b(intro|outro|ending)\b/.test(lower)) return { min: 0, max: 1 };
  if (/\b(hook|chorus|refrain)\b/.test(lower)) return { min: 2, max: 6 };
  if (/\b(bridge|break)\b/.test(lower)) return { min: 1, max: 3 };
  return { min: 4, max: 21 };
}

export function repairLineCount(lyrics: string): string {
  return parseLyricsSections(lyrics)
    .map((section) => {
      const limit = bounds(section.tag);
      const lines = section.lines.filter((line) => line.trim()).slice(0, limit.max);
      if (lines.length === 0 && limit.min > 0) {
        return undefined;
      }
      return formatSection(section.tag || "Verse - repaired section", lines);
    })
    .filter(Boolean)
    .join("\n\n");
}

export function repairCommandLeak(lyrics: string): string {
  const sections = parseLyricsSections(lyrics);
  const needsRepair = sections.some((section) =>
    section.lines.some(isCommandLeakLine) || /\bnote\s*[:：]/i.test(section.tag)
  );
  if (!needsRepair) {
    return lyrics;
  }
  return sections
    .map((section) => {
      const hitCount = section.lines.filter(isCommandLeakLine).length;
      if (hitCount > 5) {
        return undefined;
      }
      const lines = section.lines.filter((line) => {
        if (!isCommandLeakLine(line)) {
          return true;
        }
        return false;
      });
      const tag = sanitizeSectionTag(section.tag || "Verse - repaired section");
      return formatSection(tag, lines);
    })
    .filter(Boolean)
    .join("\n\n");
}

export function repairLyricsV55(lyrics: string): string {
  return repairCommandLeak(repairLineCount(repairMissingMetatags(lyrics))).trim();
}
