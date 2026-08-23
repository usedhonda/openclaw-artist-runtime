// One brief renderer, one schema. Before this module two writers emitted the
// song brief with divergent schemas — songStateInjector.renderBrief (producer
// commission: `- Lyrics theme:`, `- Tempo: NNN BPM`, `## Frozen sources`) and
// songIdeation.buildBrief (autonomous ideation: `- Core theme:`, `- Emotional
// mode:`, `- Tempo band:`, `## Observation source`). Each downstream stage read
// those strings back with its own regex, so a field one writer emitted and the
// other did not (a bpm line on the ideation path, a tempo band on the commission
// path) silently vanished — inventory bug #1: readBriefTempo matches only
// `- Tempo:`, so ideation songs lost their bpm to the mid default while the band
// still resolved, and one brief could carry a bpm and a band that disagree.
//
// Both writers now build a BriefModel and route through renderBrief. The model is
// the superset of every field either path needs; renderBrief emits a Direction
// line only for the fields that are set, so a commission brief and an ideation
// brief still differ in which lines appear — but they share one schema, one field
// order, and one formatter, and the machine source of truth is song-plan.json
// (this brief is the human-readable summary). Callers set tempoBand and tempoLine
// to agree (a single tempo source per brief) so bug #1 cannot recur.

import type { TempoBand } from "../suno-production/durationPlan.js";

export interface BriefFrozenSource {
  kind: string;
  url: string;
  author?: string;
  quote?: string;
}

export interface BriefObservation {
  path: string; // filesystem ref or the "(runtime observation)" placeholder
  author: string;
  url: string;
  quote: string;
  motivation: string;
  extract: string; // multi-line raw extract body, rendered verbatim after "- Extract:"
}

export interface BriefModel {
  title: string;
  // Section bodies. A commission brief sets `commission`; an ideation brief sets
  // `whyExists`. Both are optional so the renderer emits only the section present.
  commission?: string;
  whyExists?: string;
  // Direction lines. Each is emitted (in this fixed order) only when set, so the
  // relative order of every line each path already emitted is preserved.
  coreTheme?: string;
  artistReason?: string;
  lyricsTheme?: string;
  mood?: string;
  emotionalModeLabel?: string;
  tempoBand?: TempoBand;
  tempoLine?: string; // the `- Tempo:` value: "142 BPM" | "artist decides" | ...
  duration?: string;
  styleNotes?: string;
  // Trailing keyless Direction bullets (e.g. "Keep the images concrete...").
  directionExtras?: string[];
  observation?: BriefObservation;
  frozenSources?: BriefFrozenSource[];
}

function frozenSourceLine(source: BriefFrozenSource): string {
  const author = source.author ? ` (${source.author})` : "";
  const quote = source.quote ? ` — ${source.quote}` : "";
  return `- ${source.kind}: ${source.url}${author}${quote}`;
}

export function renderBrief(model: BriefModel): string {
  const lines: string[] = [`# Brief for ${model.title}`, ""];

  if (model.commission !== undefined) {
    lines.push("## Producer commission", "", model.commission, "");
  }
  if (model.whyExists !== undefined) {
    lines.push("## Why this song exists", "", model.whyExists, "");
  }

  lines.push("## Direction", "");
  const direction: string[] = [];
  const addLine = (label: string, value: string | undefined): void => {
    if (value !== undefined) direction.push(`- ${label}: ${value}`);
  };
  addLine("Core theme", model.coreTheme);
  addLine("Artist reason", model.artistReason);
  addLine("Lyrics theme", model.lyricsTheme);
  addLine("Mood", model.mood);
  addLine("Emotional mode", model.emotionalModeLabel);
  addLine("Tempo band", model.tempoBand);
  addLine("Tempo", model.tempoLine);
  addLine("Duration", model.duration);
  addLine("Style notes", model.styleNotes);
  for (const extra of model.directionExtras ?? []) direction.push(`- ${extra}`);
  lines.push(...direction);

  if (model.observation) {
    lines.push(
      "",
      "## Observation source",
      "",
      `- Path: ${model.observation.path}`,
      `- Author: ${model.observation.author}`,
      `- URL: ${model.observation.url}`,
      `- Quote: ${model.observation.quote}`,
      `- Motivation: ${model.observation.motivation}`,
      "- Extract:",
      model.observation.extract
    );
  }

  if (model.frozenSources?.length) {
    lines.push("", "## Frozen sources", "", ...model.frozenSources.map(frozenSourceLine));
  }

  return lines.join("\n");
}
