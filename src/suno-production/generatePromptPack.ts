import { createHash } from "node:crypto";
import type { CreateSunoPromptPackInput, SunoPromptPack, SunoSliders } from "../types.js";
import { validateSunoPromptPack } from "../validators/promptPackValidator.js";
import { buildExclude as buildExcludeV55 } from "./buildExclude.js";
import { buildSliders as buildSlidersV55 } from "./buildSliders.js";
import { buildStyle as buildStyleV55 } from "./buildStyle.js";
import { buildYaml as buildYamlV55 } from "./buildYaml.js";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildPayload(input: CreateSunoPromptPackInput, style: string, exclude: string, yamlLyrics: string, sliders: SunoSliders): Record<string, unknown> {
  return {
    songId: input.songId,
    songName: input.songTitle,
    artistReason: input.artistReason,
    styleAndFeel: style,
    excludeStyles: exclude,
    lyrics: yamlLyrics,
    lyricsText: input.lyricsText,
    lyricsYaml: yamlLyrics,
    sliders
  };
}

export function createSunoPromptPack(input: CreateSunoPromptPackInput): SunoPromptPack {
  const genre = `${input.artistReason} ${input.moodHint ?? ""}`;
  const styleResult = buildStyleV55({
    artistProfile: input.artistSnapshot,
    brief: input.artistReason,
    moodHint: input.moodHint,
    genre,
    vibe: input.moodHint
  });
  const style = styleResult.total;
  const exclude = buildExcludeV55({
    genre,
    artistAvoid: ["generic EDM drop", "fake crowd noise"],
    copyrightSourceNameDenylist: [input.songTitle]
  }).text;
  const yamlLyrics = buildYamlV55({
    title: input.songTitle,
    lyrics: input.lyricsText,
    meta: {
      tempo: 124,
      key: "minor",
      signature: "4/4",
      form: "intro-verse-hook-verse-bridge-verse-hook-outro",
      vibe: input.moodHint ?? "observational dusk",
      language: "ja"
    },
    vocals: "close, dry lead vocal; keep doubles restrained and intelligible",
    productionNotes: "bass forward, restrained drums, no novelty genre pivot",
    notes: "original lyrics and style only; no source-name imitation"
  });
  const sliders = buildSlidersV55({ genre, moodHint: input.moodHint });
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
    lyricsBundle: {
      lyricsText: input.lyricsText,
      yamlLyrics,
      moodHint: input.moodHint
    },
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
