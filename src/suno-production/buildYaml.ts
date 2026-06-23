import {
  findDurationPlanSection,
  getDurationPlan,
  type DurationPlan
} from "./durationPlan.js";

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
  lyricsBoxLimit?: number;
  durationPlan?: DurationPlan;
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

function canonicalDurationLabel(label: string, index: string): string {
  const cleanIndex = index.trim();
  if (/^final\s+(?:hook|chorus)$/i.test(label)) return "Final Hook";
  if (/^pre[-\s]?chorus$/i.test(label)) return cleanIndex ? `Pre-Hook ${cleanIndex}` : "Pre-Hook";
  if (/^pre[-\s]?hook$/i.test(label)) return cleanIndex ? `Pre-Hook ${cleanIndex}` : "Pre-Hook";
  if (/^chorus$/i.test(label)) return cleanIndex ? `Hook ${cleanIndex}` : "Hook";
  return cleanIndex ? `${label} ${cleanIndex}` : label;
}

function decorateBareHeader(line: string, gender: "male" | "female" | "neutral", plan: DurationPlan): string {
  const match = line.match(/^\[(Intro|Verse|Hook|Chorus|Bridge|Outro|Pre-Chorus|Pre-Hook|Final Hook|Final Chorus)(\s+\d+)?\]$/i);
  if (!match) return line;
  const label = match[1];
  const index = match[2] ?? "";
  const voice = gender === "female" ? "close female lead" : gender === "neutral" ? "dry lead" : "mid-range male vocal";
  const canonical = canonicalDurationLabel(label, index);
  const section = findDurationPlanSection(canonical, plan);
  if (!section) return line;
  return `[${canonical} - ${section.modifier}, ${voice}]`;
}

export function prepareSunoLyrics(
  lyrics: string,
  gender: "male" | "female" | "neutral" = "male",
  plan: DurationPlan = getDurationPlan()
): string {
  return lyrics
    .split(/\r?\n/)
    .map((line) => decorateBareHeader(line.trimEnd(), gender, plan))
    .join("\n")
    .trim();
}

export function computeBudgetLevel(lyrics: string, lyricsBoxLimit = 4800): YamlBudgetLevel {
  const margin = lyricsBoxLimit - lyrics.length - 40;
  if (margin <= 500) return "minimal";
  if (margin <= 1100) return "normal";
  if (margin <= 1800) return "expanded";
  return "max";
}

function takeByLevel<T>(items: T[], level: YamlBudgetLevel): T[] {
  const count = level === "normal" ? 1 : level === "expanded" ? 2 : items.length;
  return items.slice(0, count);
}

function durationPlanMetaLines(plan: DurationPlan, level: YamlBudgetLevel): string[] {
  if (level === "minimal") {
    return [
      "duration_plan:",
      `  target_seconds: ${plan.targetSeconds}`,
      `  planned_bars: ${plan.totalPlannedBars}`
    ];
  }
  const lines = [
    "duration_plan:",
    `  template: ${plan.templateId}`,
    `  target_seconds: ${plan.targetSeconds}`,
    `  target_range: ${plan.minSeconds}-${plan.maxSeconds}`,
    `  planned_bars: ${plan.totalPlannedBars}`,
    `  bpm_target: ${plan.bpm.target}`,
    `  no_double_time: ${plan.bpm.noDoubleTimeVocal ? "true" : "false"}`,
    `  hook_repeats: ${plan.chorusPolicy.physicalRepeats}`,
    `  final_hook: ${plan.chorusPolicy.finalChorusMode}`
  ];
  if (level === "expanded" || level === "max") {
    lines.push("  sections:");
    for (const section of plan.sectionPlan) {
      lines.push(
        `    - ${section.label}: ${section.bars} bars; ${section.lineTarget}; ${section.modifier}`
      );
    }
  }
  return lines;
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
  const durationPlan = input.durationPlan ?? getDurationPlan();
  const cues = input.cues?.map((item) => cleanLine(item, "")).filter(Boolean) ?? [];
  const lines = level === "minimal" ? [
    "# META (hints; do not sing)",
    `title: ${cleanLine(input.title, "untitled")}`,
    `form: ${cleanLine(input.meta.form, durationPlan.form)}`,
    `tempo: ${cleanLine(input.meta.tempo, "124")}`,
    `language: ${cleanLine(input.meta.language, "ja")}`
  ] : [
    "# META (hints; do not sing)",
    "version: v5.5",
    `title: ${cleanLine(input.title, "untitled")}`,
    `tempo: ${cleanLine(input.meta.tempo, "124")}`,
    `key: ${cleanLine(input.meta.key, "minor")}`,
    `signature: ${cleanLine(input.meta.signature, "4/4")}`,
    `form: ${cleanLine(input.meta.form, durationPlan.form)}`,
    `vibe: ${cleanLine(input.meta.vibe, "observational dusk")}`,
    `language: ${cleanLine(input.meta.language, "ja")}`
  ];
  lines.push("", ...durationPlanMetaLines(durationPlan, level));
  if (level !== "minimal") {
    if (cues.length) {
      lines.push("", "cues:");
      const cueCount = level === "normal" ? Math.min(2, cues.length) : cues.length;
      for (const cue of cues.slice(0, cueCount)) {
        lines.push(`  - ${cue}`);
      }
    }
    lines.push("", "vocals:");
    if (level === "max") {
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
  return [...lines, "", "=== LYRICS START (do not sing tags) ===", input.lyrics.trim(), "=== LYRICS END ==="].join("\n");
}

export function buildYaml(input: BuildYamlInput): string {
  const lyricsBoxLimit = input.lyricsBoxLimit ?? 4800;
  const durationPlan = input.durationPlan ?? getDurationPlan();
  const leadGender = typeof input.vocals === "string" ? "male" : input.vocals?.parts?.find((part) => part.id === "lead")?.gender ?? "male";
  const preparedInput = {
    ...input,
    meta: {
      ...input.meta,
      form: input.meta.form ?? durationPlan.form
    },
    lyrics: prepareSunoLyrics(input.lyrics, leadGender, durationPlan)
  };
  const levels: YamlBudgetLevel[] = ["minimal", "normal", "expanded", "max"];
  const start = levels.indexOf(computeBudgetLevel(preparedInput.lyrics, lyricsBoxLimit));
  for (let index = start; index >= 0; index -= 1) {
    const level = levels[index] ?? "minimal";
    const yaml = renderYaml(preparedInput, level);
    if (yaml.length <= lyricsBoxLimit) {
      return yaml;
    }
  }
  throw new Error(`YAML overflow at ${computeBudgetLevel(preparedInput.lyrics, lyricsBoxLimit)}: ${preparedInput.lyrics.length}/${lyricsBoxLimit}`);
}
