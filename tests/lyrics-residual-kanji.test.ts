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

  it("normalizes 3-4 digit numbers with positional readings (live spawn_cc1049 ascii_number:145 stall)", () => {
    expect(normalizeAsciiNumbersToHiragana("145だんめのかいだん")).toBe("ひゃくよんじゅうごだんめのかいだん");
    expect(normalizeAsciiNumbersToHiragana("2026ねんのまち")).toBe("にせんにじゅうろくねんのまち");
    // 1-2 digit natural readings stay intact alongside a 3-digit token
    expect(normalizeAsciiNumbersToHiragana("12と 300")).toBe("じゅうにと さんびゃく");
  });

  it("reads positional numbers deterministically across the boundaries (99/100/145/1000/9999) with digit fallback above", () => {
    expect(asciiNumberToHiragana(99)).toBe("きゅうじゅうきゅう");
    expect(asciiNumberToHiragana(100)).toBe("ひゃく");
    expect(asciiNumberToHiragana(145)).toBe("ひゃくよんじゅうご");
    expect(asciiNumberToHiragana(1000)).toBe("せん");
    expect(asciiNumberToHiragana(9999)).toBe("きゅうせんきゅうひゃくきゅうじゅうきゅう");
    // rendaku / gemination readings
    expect(asciiNumberToHiragana(300)).toBe("さんびゃく");
    expect(asciiNumberToHiragana(600)).toBe("ろっぴゃく");
    expect(asciiNumberToHiragana(800)).toBe("はっぴゃく");
    expect(asciiNumberToHiragana(3000)).toBe("さんぜん");
    expect(asciiNumberToHiragana(8000)).toBe("はっせん");
    // >= 10000 falls back to digit-by-digit reading (rare, no compact reading)
    expect(normalizeAsciiNumbersToHiragana("10000のよる")).toBe("いちぜろぜろぜろぜろのよる");
    expect(() => asciiNumberToHiragana(10000)).toThrow(/unsupported_ascii_number/);
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

  it("normalizes the newly reported stalling kanji (鳴/皮肉/広告/利上げ/偶然)", () => {
    expect(normalizeSunoRegistrationJapanese("むねで鳴る\nそれは皮肉なひかり")).toBe("むねでなる\nそれはひにくなひかり");
    expect(normalizeSunoRegistrationJapanese("広告のまち\n利上げのニュース\n偶然のかお")).toBe("こうこくのまち\nりあげのニュース\nぐうぜんのかお");
  });

  it("repairs 鳴る and 皮肉 in a pack so validation passes (spawn_cc1049 stall)", () => {
    const pack = createSunoPromptPack({
      songId: "song-cc1049-repro",
      songTitle: "共有現実の外",
      artistReason: "residual kanji stall repro",
      lyricsText: "[Verse 1]\nむねで鳴る\n[Verse 2]\nそれは皮肉なひかり",
      artistSnapshot: "# ARTIST\nused::honda",
      currentStateSnapshot: "# CURRENT\n"
    });

    const warnings = pack.payload.languageWarnings as string[];
    expect(warnings).not.toContain("residual_kanji:鳴:line_2");
    expect(warnings.some((warning) => warning.startsWith("residual_kanji:皮肉"))).toBe(false);
    expect(pack.lyricsBundle?.lyricsText).toContain("むねでなる");
    expect(pack.lyricsBundle?.lyricsText).toContain("ひにく");
    expect(pack.validation.valid).toBe(true);
  });

  it("keeps compounds intact by applying longer readings before component kanji (利上げ, 街角)", () => {
    expect(normalizeSunoRegistrationJapanese("利上げだけがのこる")).toBe("りあげだけがのこる");
    expect(normalizeSunoRegistrationJapanese("街角のノイズ")).toBe("まちかどのノイズ");
  });

  it("normalizes the second live spawn_cc1049 stall set (売 + 3-digit number)", () => {
    expect(normalizeSunoRegistrationJapanese("売れるまちで 145 かぞえる")).toBe("うれるまちで ひゃくよんじゅうご かぞえる");
    expect(normalizeSunoRegistrationJapanese("たましいを売る")).toBe("たましいをうる");
  });

  it("normalizes canon vocabulary from song-105 without residual kanji", () => {
    const registrationLyrics = normalizeSunoRegistrationJapanese([
      "スポンサー席から 見つもりを読む",
      "白いポスターに 職業病の数字",
      "診断、しぶや。処方、しぶや",
      "売る側も買う側も 払いを刺す",
      "整形の量産ラインに 住民票と在庫"
    ].join("\n"));

    expect(lintResidualKanji(registrationLyrics)).toEqual([]);
  });
});
