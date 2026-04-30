import { createHash } from "node:crypto";
import type { CreateSunoPromptPackInput, SunoPromptPack, SunoSliders } from "../types.js";
import { validateSunoPromptPack } from "../validators/promptPackValidator.js";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildStyle(input: CreateSunoPromptPackInput): string {
  const moodHint = input.moodHint?.trim();
  const intent = input.artistReason ? `song intent: ${input.artistReason}` : undefined;
  const tokens = [
    "alternative pop",
    "close fragile vocal",
    "cold synth texture",
    moodHint,
    "restrained drums",
    intent
  ].filter(Boolean) as string[];
  const style = tokens.join(", ");
  if (style.length <= 200) {
    return style;
  }
  const withoutIntent = intent ? tokens.filter((token) => token !== intent).join(", ") : style;
  if (withoutIntent.length <= 200 || !moodHint) {
    return withoutIntent.slice(0, 200);
  }
  return tokens.filter((token) => token !== intent && token !== moodHint).join(", ").slice(0, 200);
}

function buildExclude(): string {
  return "generic EDM drop, celebrity voice imitation, copyrighted artist cloning, fake crowd noise";
}

function buildYamlLyrics(input: CreateSunoPromptPackInput): string {
  return [
    `title: ${input.songTitle}`,
    "sections:",
    "  - type: verse",
    "    lines:",
    ...input.lyricsText.split("\n").filter(Boolean).map((line) => `      - ${line}`)
  ].join("\n");
}

function buildSliders(): SunoSliders {
  return {
    weirdness: 42,
    styleInfluence: 72,
    audioInfluence: 25
  };
}

function buildPayload(input: CreateSunoPromptPackInput, style: string, exclude: string, yamlLyrics: string, sliders: SunoSliders): Record<string, unknown> {
  return {
    songId: input.songId,
    songName: input.songTitle,
    artistReason: input.artistReason,
    styleAndFeel: style,
    excludeStyles: exclude,
    lyricsText: input.lyricsText,
    lyricsYaml: yamlLyrics,
    sliders
  };
}

export function createSunoPromptPack(input: CreateSunoPromptPackInput): SunoPromptPack {
  const style = buildStyle(input);
  const exclude = buildExclude();
  const yamlLyrics = buildYamlLyrics(input);
  const sliders = buildSliders();
  const payload = buildPayload(input, style, exclude, yamlLyrics, sliders);
  const payloadHash = hashText(JSON.stringify(payload));
  const promptHash = hashText(`${style}\n${exclude}\n${yamlLyrics}`);
  const artistSnapshotHash = hashText(input.artistSnapshot);
  const currentStateHash = hashText(input.currentStateSnapshot);
  const knowledgePackHash = hashText(input.knowledgePackVersion ?? "knowledge-pack:unknown");

  const pack: SunoPromptPack = {
    songId: input.songId,
    songTitle: input.songTitle,
    artistReason: input.artistReason,
    style,
    exclude,
    yamlLyrics,
    sliders,
    payload,
    validation: { valid: true, errors: [] },
    promptHash,
    payloadHash,
    artistSnapshotHash,
    currentStateHash,
    knowledgePackHash
  };

  pack.validation = validateSunoPromptPack(pack);
  return pack;
}
