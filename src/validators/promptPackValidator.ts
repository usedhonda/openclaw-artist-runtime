import type { SunoPromptPack, SunoPromptPackValidation } from "../types.js";

function sunoLyricsBoxLimit(): number {
  const parsed = Number.parseInt(process.env.OPENCLAW_SUNO_LYRICS_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
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
    const lyrics = typeof pack.payload.lyrics === "string" ? pack.payload.lyrics : "";
    if (lyrics.length < 1500) {
      warnings.push(`lyrics length below preferred floor: ${lyrics.length}`);
    }
    if (lyrics.length > 3000) {
      errors.push(`lyrics length out of range: ${lyrics.length}`);
    }
    const payloadYaml = typeof pack.payload.payloadYaml === "string" ? pack.payload.payloadYaml : "";
    const lyricsLimit = sunoLyricsBoxLimit();
    if (payloadYaml.length > lyricsLimit) {
      errors.push(`payloadYaml length exceeds Suno lyrics box limit: ${payloadYaml.length}/${lyricsLimit}`);
    }
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
