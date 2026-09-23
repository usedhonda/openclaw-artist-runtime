import { describe, expect, it } from "vitest";
import { lintJapaneseLyricsEnglishFragments } from "../src/services/lyricsLanguageLint";

describe("lyrics language lint", () => {
  it("warns on English fragments in Japanese lyrics while ignoring headers", () => {
    const warnings = lintJapaneseLyricsEnglishFragments([
      "[Verse 1 - tight flow]",
      "街の light が遅れる",
      "短い go は許容しないが four は拾う"
    ].join("\n"));

    expect(warnings.map((warning) => warning.token)).toEqual(["light", "four"]);
    expect(warnings[0]?.line).toBe(2);
  });
});
