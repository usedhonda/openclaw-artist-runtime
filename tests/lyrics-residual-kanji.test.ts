import { describe, expect, it } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";
import {
  asciiNumberToHiragana,
  lintResidualKanji,
  normalizeAsciiNumbersToHiragana,
  normalizeSunoRegistrationJapanese
} from "../src/services/lyricsLanguageLint";

describe("residual kanji lyrics lint", () => {
  it("warns on residual kanji and ascii numbers while ignoring section headers", () => {
    const warnings = lintResidualKanji([
      "[Verse 1 - 安全圏 cue]",
      "安全圏の芝で 12 かぞえる",
      "ひらがなだけのらいん"
    ].join("\n"));

    expect(warnings).toEqual([
      { token: "安全圏", line: 2, kind: "residual_kanji" },
      { token: "芝", line: 2, kind: "residual_kanji" },
      { token: "12", line: 2, kind: "ascii_number" }
    ]);
  });

  it("normalizes one and two digit ascii numbers deterministically", () => {
    expect(asciiNumberToHiragana(0)).toBe("ぜろ");
    expect(asciiNumberToHiragana(7)).toBe("なな");
    expect(asciiNumberToHiragana(10)).toBe("じゅう");
    expect(asciiNumberToHiragana(21)).toBe("にじゅういち");
    expect(normalizeAsciiNumbersToHiragana("3つの信号と 42 の窓")).toBe("さんつの信号と よんじゅうに の窓");
  });

  it("repairs known residual kanji for Suno registration while preserving the original lyrics source", () => {
    const pack = createSunoPromptPack({
      songId: "song-kanji",
      songTitle: "安全圏の芝",
      artistReason: "kanji warning test",
      lyricsText: "[Verse 1]\n安全圏で 4 つ light がゆれる",
      artistSnapshot: "# ARTIST\nused::honda",
      currentStateSnapshot: "# CURRENT\n"
    });

    const warnings = pack.payload.languageWarnings as string[];
    expect(warnings).toContain("english_fragment:light:line_2");
    expect(warnings).not.toContain("residual_kanji:安全圏:line_2");
    expect(warnings).not.toContain("ascii_number:4:line_2");
    expect(pack.lyricsBundle?.originalLyricsText).toContain("安全圏で 4 つ light がゆれる");
    expect(pack.lyricsBundle?.lyricsText).toContain("あんぜんけんで よん つ light がゆれる");
    expect(String(pack.payload.lyrics)).toContain("よん");
    expect(pack.validation.valid).toBe(true);
  });

  it("still fails validation when unknown kanji remain after bounded Suno repair", () => {
    const pack = createSunoPromptPack({
      songId: "song-unknown-kanji",
      songTitle: "Unknown Gate",
      artistReason: "unknown kanji must not be hidden",
      lyricsText: "[Verse 1]\n蜃気楼で light がゆれる",
      artistSnapshot: "# ARTIST\nused::honda",
      currentStateSnapshot: "# CURRENT\n"
    });

    const warnings = pack.payload.languageWarnings as string[];
    expect(warnings).toContain("english_fragment:light:line_2");
    expect(warnings).toContain("residual_kanji:蜃気楼:line_2");
    expect(pack.validation.valid).toBe(false);
    expect(pack.validation.errors.join("\n")).toContain("non-hiragana Japanese");
  });

  it("normalizes the current Suno-stalling residual kanji set", () => {
    expect(normalizeSunoRegistrationJapanese("スポンサー名がならぶ\n消えるのはまちかど\n拍手のあとで")).toBe("スポンサーめいがならぶ\nきえるのはまちかど\nはくしゅのあとで");
  });
});
