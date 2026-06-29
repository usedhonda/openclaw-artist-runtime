import { describe, expect, it } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";

function pack(vocalGender?: "male" | "female" | "neutral") {
  return createSunoPromptPack({
    songId: "song-gender",
    songTitle: "Gender Gate",
    artistReason: "voice gender must be explicit",
    lyricsText: "[Verse 1]\nまちのしろいあかりがのこる",
    moodHint: "dry civic pulse",
    artistSnapshot: "# ARTIST\n\n### Voice\n\n- gender: male",
    currentStateSnapshot: "# CURRENT",
    vocalGender
  });
}

describe("Suno V5.5 vocal gender", () => {
  it("defaults used::honda prompt packs to male lead vocal", () => {
    const result = pack();

    expect(result.yamlLyrics).toContain("gender: male");
    expect(result.style).toMatch(/male/i);
    expect(result.validation.valid).toBe(true);
  });

  it("allows explicit gender override", () => {
    const result = pack("female");

    expect(result.yamlLyrics).toContain("gender: female");
    expect(result.style).toMatch(/female/i);
  });
});
