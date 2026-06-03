export type YamlBudgetLevel = "minimal" | "normal" | "expanded" | "max";

export interface BuildYamlMeta {
  tempo?: number;
  key?: string;
  signature?: string;
  form?: string;
  vibe?: string;
  language?: string;
}

export interface BuildYamlVocalPart {
  id: string;
  tone: string;
  gender?: "male" | "female" | "neutral";
}

export type BuildYamlVocals = string | {
  parts?: BuildYamlVocalPart[];
  rules?: string[];
};

export interface BuildYamlInput {
  title: string;
  lyrics: string;
  meta: BuildYamlMeta;
  vocals?: BuildYamlVocals;
  productionNotes?: string | string[];
  production_notes?: string | string[];
  notes?: string | string[];
  cues?: string[];
}

function cleanLine(value: string | number | undefined, fallback: string): string {
  return String(value ?? fallback).replace(/\r?\n/g, " ").trim();
}

function list(value: string | string[] | undefined, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => cleanLine(item, "")).filter(Boolean);
  }
  if (value) {
    return [cleanLine(value, "")].filter(Boolean);
  }
  return fallback;
}

function vocalRules(value: BuildYamlVocals | undefined): string[] {
  if (typeof value === "string") {
    return [cleanLine(value, "")].filter(Boolean);
  }
  return value?.rules?.map((item) => cleanLine(item, "")).filter(Boolean) ?? [
    "close, dry lead vocal; restrained doubles only where the hook needs lift",
    "keep consonants intelligible and avoid novelty character voices"
  ];
}

function vocalParts(value: BuildYamlVocals | undefined): BuildYamlVocalPart[] {
  if (!value || typeof value === "string") {
    return [{ id: "lead", tone: "close, dry, intimate", gender: "male" }];
  }
  return value.parts?.map((part) => ({
    id: cleanLine(part.id, "lead"),
    tone: cleanLine(part.tone, "close, dry, intimate"),
    gender: part.gender ?? "male"
  })) ?? [{ id: "lead", tone: "close, dry, intimate", gender: "male" }];
}

function decorateBareHeader(line: string, gender: "male" | "female" | "neutral"): string {
  const match = line.match(/^\[(Intro|Verse|Hook|Chorus|Bridge|Outro|Pre-Chorus)(\s+\d+)?\]$/i);
  if (!match) return line;
  const label = match[1];
  const index = match[2] ?? "";
  const lower = label.toLowerCase();
  const voice = gender === "female" ? "close female lead" : gender === "neutral" ? "dry lead" : "mid-range male vocal";
  const modifier = lower.includes("verse")
    ? `tight flow, restrained backing, ${voice}`
    : lower.includes("hook") || lower.includes("chorus")
      ? `short refrain, narrow doubles, ${voice}`
      : lower.includes("bridge")
        ? `reduced drums, breath room, ${voice}`
        : `sparse texture, ${voice}`;
  return `[${label}${index} - ${modifier}]`;
}

export function prepareSunoLyrics(lyrics: string, gender: "male" | "female" | "neutral" = "male"): string {
  return lyrics
    .split(/\r?\n/)
    .map((line) => decorateBareHeader(line.trimEnd(), gender))
    .join("\n")
    .trim();
}

export function computeBudgetLevel(lyrics: string): YamlBudgetLevel {
  const margin = 4500 - lyrics.length - 40;
  if (margin <= 200) return "minimal";
  if (margin <= 600) return "normal";
  if (margin <= 1200) return "expanded";
  return "max";
}

function takeByLevel<T>(items: T[], level: YamlBudgetLevel): T[] {
  const count = level === "normal" ? 1 : level === "expanded" ? 2 : items.length;
  return items.slice(0, count);
}

function renderYaml(input: BuildYamlInput, level: YamlBudgetLevel): string {
  const productionNotes = list(input.production_notes ?? input.productionNotes, [
    "keep arrangement sparse enough for lyric intelligibility",
    "avoid novelty genre pivots and leave space around the lead vocal"
  ]);
  const notes = list(input.notes, [
    "original lyrics and style only; no source-name imitation",
    "metadata stays descriptive; lyrics body carries the singable text"
  ]);
  const rules = vocalRules(input.vocals);
  const parts = vocalParts(input.vocals);
  const lines = level === "minimal" ? [
    "# META (hints; do not sing)",
    `title: ${cleanLine(input.title, "untitled")}`,
    `tempo: ${cleanLine(input.meta.tempo, "124")}`,
    `language: ${cleanLine(input.meta.language, "ja")}`
  ] : [
    "# META (hints; do not sing)",
    "version: v5.5",
    `title: ${cleanLine(input.title, "untitled")}`,
    `tempo: ${cleanLine(input.meta.tempo, "124")}`,
    `key: ${cleanLine(input.meta.key, "minor")}`,
    `signature: ${cleanLine(input.meta.signature, "4/4")}`,
    `form: ${cleanLine(input.meta.form, "intro-verse-hook-verse-bridge-verse-hook-outro")}`,
    `vibe: ${cleanLine(input.meta.vibe, "observational dusk")}`,
    `language: ${cleanLine(input.meta.language, "ja")}`
  ];
  if (level !== "minimal") {
    lines.push("", "vocals:");
    if (level === "expanded" || level === "max") {
      lines.push("  parts:");
      for (const part of parts) {
        lines.push(`    - id: ${part.id}`, `      gender: ${part.gender ?? "male"}`, `      tone: ${part.tone}`);
      }
    }
    lines.push("  rules:");
    for (const rule of takeByLevel(rules, level)) {
      lines.push(`    - ${rule}`);
    }
    lines.push("", "production_notes:");
    for (const note of takeByLevel(productionNotes, level)) {
      lines.push(`  - ${note}`);
    }
    lines.push("", "notes:");
    for (const note of takeByLevel(notes, level)) {
      lines.push(`  - ${note}`);
    }
  }
  if (level === "max" && input.cues?.length) {
    lines.push("", "cues:");
    for (const cue of input.cues.map((item) => cleanLine(item, "")).filter(Boolean)) {
      lines.push(`  - ${cue}`);
    }
  }
  return [...lines, "", "=== LYRICS START (do not sing tags) ===", input.lyrics.trim(), "=== LYRICS END ==="].join("\n");
}

export function buildYaml(input: BuildYamlInput): string {
  const leadGender = typeof input.vocals === "string" ? "male" : input.vocals?.parts?.find((part) => part.id === "lead")?.gender ?? "male";
  const preparedInput = {
    ...input,
    lyrics: prepareSunoLyrics(input.lyrics, leadGender)
  };
  const levels: YamlBudgetLevel[] = ["minimal", "normal", "expanded", "max"];
  const start = levels.indexOf(computeBudgetLevel(preparedInput.lyrics));
  for (let index = start; index >= 0; index -= 1) {
    const level = levels[index] ?? "minimal";
    const yaml = renderYaml(preparedInput, level);
    if (yaml.length <= 4500) {
      return yaml;
    }
  }
  throw new Error(`YAML overflow at ${computeBudgetLevel(preparedInput.lyrics)}`);
}
