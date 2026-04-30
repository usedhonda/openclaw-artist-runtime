import { createHash } from "node:crypto";
import type { CreateSunoPromptPackInput, SunoPromptPack, SunoSliders } from "../types.js";
import { validateSunoPromptPack } from "../validators/promptPackValidator.js";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildStyle(input: CreateSunoPromptPackInput): string {
  const tokens = [
    "alternative pop",
    "close fragile vocal",
    "cold synth texture",
    input.moodHint?.trim(),
    "restrained drums",
    `song intent: ${input.artistReason}`
  ].filter(Boolean) as string[];
  const style = tokens.join(", ");
  if (style.length <= 120 || !input.moodHint?.trim()) {
    return style.slice(0, 120);
  }
  return tokens.filter((token) => token !== input.moodHint?.trim()).join(", ").slice(0, 120);
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
    lyrics: yamlLyrics,
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
