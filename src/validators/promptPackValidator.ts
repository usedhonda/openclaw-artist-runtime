import type { SunoPromptPack, SunoPromptPackValidation } from "../types.js";
import { getSunoLyricsLimit } from "../services/runtimeConfig.js";
import { extractLyricsBody } from "../services/lyricsExtraction.js";
import { DEFAULT_USED_HONDA_DURATION_PLAN } from "../suno-production/durationPlan.js";

function sunoLyricsBoxLimit(): number {
  return getSunoLyricsLimit();
}

function headerLabels(lyrics: string): string[] {
  return lyrics
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^\[([^\]]+)\]$/)?.[1]?.split(" - ")[0]?.trim())
    .filter((label): label is string => Boolean(label));
}

function plannedBarsFromHeaders(lyrics: string): number {
  return lyrics
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.match(/^\[[^\]]*?\b(\d+)\s+bars\b/i)?.[1] ?? "", 10))
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
}

function validateDurationPlanStructure(payloadYaml: string, warnings: string[]): void {
  if (!payloadYaml.includes("duration_plan:") && !payloadYaml.includes("LYRICS START")) {
    return;
  }
  const plan = DEFAULT_USED_HONDA_DURATION_PLAN;
  const lyrics = extractLyricsBody(payloadYaml);
  const labels = headerLabels(lyrics);
  const sectionCount = labels.length;
  const prehookCount = labels.filter((label) => /^pre[-\s]?hook/i.test(label) || /^pre[-\s]?chorus/i.test(label)).length;
  const hookRepeatCount = labels.filter((label) => /^(?:hook|chorus)(?:\s+\d+)?$/i.test(label) || /^final\s+(?:hook|chorus)$/i.test(label)).length;
  const plannedBars = plannedBarsFromHeaders(lyrics);
  if (sectionCount < plan.sectionPlan.length) {
    warnings.push(`duration_plan_section_count_below_plan: ${sectionCount}/${plan.sectionPlan.length}`);
  }
  if (prehookCount < 2) {
    warnings.push(`duration_plan_prehook_count_below_plan: ${prehookCount}/2`);
  }
  if (hookRepeatCount < plan.chorusPolicy.physicalRepeats) {
    warnings.push(`duration_plan_hook_repeats_below_plan: ${hookRepeatCount}/${plan.chorusPolicy.physicalRepeats}`);
  }
  if (plannedBars > 0 && plannedBars < plan.totalPlannedBars) {
    warnings.push(`duration_plan_planned_bars_below_plan: ${plannedBars}/${plan.totalPlannedBars}`);
  }
}

export function validateSunoPromptPack(pack: Partial<SunoPromptPack>): SunoPromptPackValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!pack.songId) {
    errors.push("missing songId");
  }
  if (!pack.songTitle) {
    errors.push("missing songTitle");
  } else if (pack.songTitle.length < 4 || pack.songTitle.length > 80) {
    errors.push(`title length out of range: ${pack.songTitle.length}`);
  }
  if (!pack.style) {
    errors.push("missing style");
  } else if (pack.style.length < 800 || pack.style.length > 1000) {
    errors.push(`styleAndFeel length out of range: ${pack.style.length}`);
  }
  if (!pack.exclude) {
    errors.push("missing exclude");
  }
  if (!pack.yamlLyrics) {
    errors.push("missing YAML lyrics");
  } else if (!/gender:\s*(male|female|neutral)/i.test(pack.yamlLyrics)) {
    errors.push("missing vocal gender");
  }
  if (!pack.payload) {
    errors.push("missing payload");
  } else {
    const payloadYaml = typeof pack.payload.payloadYaml === "string" ? pack.payload.payloadYaml : "";
    const lyricsLimit = sunoLyricsBoxLimit();
    if (payloadYaml.length > lyricsLimit) {
      errors.push(`payloadYaml length exceeds Suno lyrics box limit: ${payloadYaml.length}/${lyricsLimit}`);
    }
    if (payloadYaml && payloadYaml.length < Math.floor(lyricsLimit * 0.8)) {
      warnings.push(`payloadYaml leaves Suno lyrics box budget underused: ${payloadYaml.length}/${lyricsLimit}`);
    }
    validateDurationPlanStructure(payloadYaml, warnings);
    const warningsValue = (pack.payload as { languageWarnings?: unknown }).languageWarnings;
    if (Array.isArray(warningsValue) && warningsValue.length > 0) {
      warnings.push(...warningsValue.map(String));
    }
  }
  if (!pack.artistSnapshotHash) {
    errors.push("missing artist snapshot hash");
  }
  if (!pack.currentStateHash) {
    errors.push("missing current state hash");
  }
  if (!pack.payloadHash) {
    errors.push("missing payload hash");
  }
  if (!pack.knowledgePackHash) {
    errors.push("missing knowledge pack hash");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
