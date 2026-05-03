export interface BuildYamlInput {
  title: string;
  lyrics: string;
  meta: {
    tempo?: number;
    key?: string;
    signature?: string;
    form?: string;
    vibe?: string;
    language?: string;
  };
  vocals?: string;
  productionNotes?: string;
  notes?: string;
}

function cleanLine(value: string | number | undefined, fallback: string): string {
  return String(value ?? fallback).replace(/\r?\n/g, " ").trim();
}

export function buildYaml(input: BuildYamlInput): string {
  const yaml = [
    "# META",
    "version: v5.5",
    `title: ${cleanLine(input.title, "untitled")}`,
    `tempo: ${cleanLine(input.meta.tempo, "124")}`,
    `key: ${cleanLine(input.meta.key, "minor")}`,
    `signature: ${cleanLine(input.meta.signature, "4/4")}`,
    `form: ${cleanLine(input.meta.form, "intro-verse-hook-verse-bridge-verse-hook-outro")}`,
    `vibe: ${cleanLine(input.meta.vibe, "observational dusk")}`,
    `language: ${cleanLine(input.meta.language, "ja")}`,
    "",
    "vocals:",
    `  direction: ${cleanLine(input.vocals, "close, dry lead vocal; restrained backing doubles only where the hook needs lift")}`,
    "",
    "production_notes:",
    `  direction: ${cleanLine(input.productionNotes, "keep arrangement sparse enough for lyric intelligibility; avoid novelty genre pivots")}`,
    "",
    "notes:",
    `  direction: ${cleanLine(input.notes, "original lyrics and style only; no source-name imitation")}`,
    "",
    "LYRICS START",
    input.lyrics.trim(),
    "LYRICS END"
  ].join("\n");
  return yaml.length <= 4500 ? yaml : `${yaml.slice(0, 4484)}\nLYRICS END`;
}
