import type { BuildExcludeInput } from "./buildExclude.js";
import { STYLE_ANALYZER_SYSTEM_PROMPT } from "./styleSynthesisPrompt.js";

export interface ExcludeSynthesisPrompt {
  sourceAttribution: string;
  system: string;
  user: string;
}

export const EXCLUDE_SYNTHESIS_PROMPT_SOURCE =
  "Source: /Users/usedhonda/projects/docs/sunomanual/mygpts/style-analyzer/instructions.md (CC BY-NC 4.0, Copyright 2025-2026 usedhonda)";

export const EXCLUDE_SYNTHESIS_KNOWLEDGE_REFERENCES = [
  "suno_v55_reference.md",
  "style_catalog.md",
  "master_reference.md"
] as const;

export const EXCLUDE_SYNTHESIS_SYSTEM_PROMPT = [
  STYLE_ANALYZER_SYSTEM_PROMPT,
  "",
  "Exclude synthesis adaptation for artist-runtime:",
  "Write Exclude Styles in English only, one comma-separated line, 200 chars max, 2-5 items.",
  "No \"no X\" phrasing. Just item names.",
  "Use style_catalog.md to identify elements that clash with the requested genre, instrumentation, and mix.",
  "Never include artist names, song titles, album names, or living-artist voice cloning targets.",
  "Avoid generic filler unless the brief is sparse; prefer concrete sonic conflicts."
].join("\n");

function optionalLine(label: string, value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  const text = Array.isArray(value) ? value.join(", ") : value;
  return text.trim() ? `${label}: ${text}` : undefined;
}

export function buildExcludeSynthesisPrompt(input: BuildExcludeInput = {}): ExcludeSynthesisPrompt {
  const user = [
    "Create a safe Suno V5.5 Exclude Styles line for this original artist work.",
    "Return only the comma-separated exclude line.",
    `Knowledge references: ${EXCLUDE_SYNTHESIS_KNOWLEDGE_REFERENCES.join(", ")}`,
    optionalLine("Genre", input.genre),
    optionalLine("Known artist avoids", input.artistAvoid),
    optionalLine("Configured voices", input.voices),
    optionalLine("Copyright/source-name denylist", input.copyrightSourceNameDenylist)
  ].filter((line): line is string => Boolean(line));

  return {
    sourceAttribution: EXCLUDE_SYNTHESIS_PROMPT_SOURCE,
    system: EXCLUDE_SYNTHESIS_SYSTEM_PROMPT,
    user: user.join("\n")
  };
}
