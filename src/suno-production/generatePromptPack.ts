import { createHash } from "node:crypto";
import { extractLyricsBody } from "../services/lyricsExtraction.js";
import type { AiReviewProvider, CreateSunoPromptPackInput, SunoPromptPack, SunoSliders } from "../types.js";
import { validateSunoPromptPack } from "../validators/promptPackValidator.js";
import { buildExclude as buildExcludeV55 } from "./buildExclude.js";
import { synthesizeExclude } from "./buildExclude.js";
import { buildSliders as buildSlidersV55 } from "./buildSliders.js";
import { buildStyle as buildStyleV55 } from "./buildStyle.js";
import { synthesizeStyle } from "./buildStyle.js";
import { buildYaml as buildYamlV55 } from "./buildYaml.js";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildPayload(input: CreateSunoPromptPackInput, style: string, exclude: string, yamlLyrics: string, sliders: SunoSliders): Record<string, unknown> {
  const lyricsBody = extractLyricsBody(yamlLyrics);
  return {
    songId: input.songId,
    songName: input.songTitle,
    artistReason: input.artistReason,
    styleAndFeel: style,
    excludeStyles: exclude,
    lyrics: lyricsBody,
    lyricsText: input.lyricsText,
    payloadYaml: yamlLyrics,
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
    vocals: {
      parts: [
        { id: "lead", tone: "close, dry, intelligible" },
        { id: "hook_double", tone: "restrained width only on repeated hook lines" }
      ],
      rules: [
        "keep doubles restrained and intelligible",
        "let consonants stay forward over bass movement"
      ]
    },
    production_notes: [
      "bass forward, restrained drums, no novelty genre pivot",
      "leave enough midrange space for dense Japanese phrasing"
    ],
    notes: [
      "original lyrics and style only; no source-name imitation",
      "metadata describes delivery; lyrics body remains the singable text"
    ],
    cues: ["Intro: sparse texture before groove; Hook: widen rhythm without crowd noise"]
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

export async function createSunoPromptPackWithAi(
  input: CreateSunoPromptPackInput & { aiReviewProvider?: AiReviewProvider }
): Promise<SunoPromptPack> {
  const genre = `${input.artistReason} ${input.moodHint ?? ""}`;
  const styleResult = await synthesizeStyle({
    artistProfile: input.artistSnapshot,
    brief: input.artistReason,
    moodHint: input.moodHint,
    genre,
    vibe: input.moodHint
  }, { provider: input.aiReviewProvider });
  const excludeResult = await synthesizeExclude({
    genre,
    artistAvoid: ["generic EDM drop", "fake crowd noise"],
    copyrightSourceNameDenylist: [input.songTitle]
  }, { provider: input.aiReviewProvider });
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
    vocals: {
      parts: [
        { id: "lead", tone: "close, dry, intelligible" },
        { id: "hook_double", tone: "restrained width only on repeated hook lines" }
      ],
      rules: [
        "keep doubles restrained and intelligible",
        "let consonants stay forward over bass movement"
      ]
    },
    production_notes: [
      "bass forward, restrained drums, no novelty genre pivot",
      "leave enough midrange space for dense Japanese phrasing"
    ],
    notes: [
      "original lyrics and style only; no source-name imitation",
      "metadata describes delivery; lyrics body remains the singable text"
    ],
    cues: ["Intro: sparse texture before groove; Hook: widen rhythm without crowd noise"]
  });
  const sliders = buildSlidersV55({ genre, moodHint: input.moodHint });
  const payload = buildPayload(input, styleResult.total, excludeResult.text, yamlLyrics, sliders);
  const payloadHash = hashText(JSON.stringify(payload));
  const promptHash = hashText(`${styleResult.total}\n${excludeResult.text}\n${yamlLyrics}`);
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
    style: styleResult.total,
    exclude: excludeResult.text,
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
