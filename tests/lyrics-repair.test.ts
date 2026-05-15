import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  repairCommandLeak,
  repairLineCount,
  repairLyricsV55,
  repairMissingMetatags
} from "../src/services/lyricsRepair";
import { validateLyricsV55, validateNoCommandLeak } from "../src/services/lyricsValidator";

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");
}

describe("lyrics V5.5 repair", () => {
  it("adds annotation tags to untagged lyric lines", () => {
    const repaired = repairMissingMetatags(fixture("lyrics-v55-bad-no-tags.md"));
    expect(repaired).toContain("[Verse 1 - tight flow]");
    expect(validateLyricsV55(repaired).valid).toBe(true);
  });

  it("trims overlong sections and drops empty required sections during line count repair", () => {
    const repaired = repairLineCount([
      "[Verse 1 - tight civic flow]",
      ...Array.from({ length: 24 }, (_, index) => `line ${index + 1}`),
      "",
      "[Bridge - empty contrast]",
      "",
      "[Outro - hard stop]",
      "終わり"
    ].join("\n"));
    expect(repaired).toContain("line 21");
    expect(repaired).not.toContain("line 22");
    expect(repaired).not.toContain("[Bridge - empty contrast]");
    expect(repaired).toContain("[Outro - hard stop]");
  });

  it("moves command-like leakage out of lyric lines", () => {
    const repaired = repairCommandLeak(fixture("lyrics-v55-bad-command-leak.md"));
    expect(validateNoCommandLeak(repaired)).toEqual([]);
    expect(repaired).not.toContain("note:");
  });

  it("removes song-008 Japanese and technical meta leakage from lyric lines", () => {
    const leaked = fixture("song-008-leak.txt");
    const repaired = repairCommandLeak([
      "[Verse 1 - tight flow]",
      "ゲートのよこに, だれかのかさが ねむる",
      ...leaked.split(/\r?\n/).filter(Boolean),
      "BGMになるまで, くうきのねじを まわす"
    ].join("\n"));

    for (const line of leaked.split(/\r?\n/).filter(Boolean)) {
      expect(repaired).not.toContain(line);
    }
    expect(validateNoCommandLeak(repaired)).toEqual([]);
  });

  it("drops sections with dense songwriting-meta leakage", () => {
    const leaked = fixture("song-008-leak.txt");
    const repaired = repairCommandLeak([
      "[Verse 3 - progressive switch]",
      "ポケットのなかで, ふるえる きょうの みどころ",
      ...leaked.split(/\r?\n/).filter(Boolean),
      "",
      "[Hook - final anchor]",
      "BGMにして ぬけろ",
      "Gateがなる, まちがずれる"
    ].join("\n"));

    expect(repaired).not.toContain("[Verse 3 - progressive switch]");
    expect(repaired).not.toContain("ポケットのなかで");
    expect(repaired).toContain("[Hook - final anchor]");
  });

  it("runs deterministic repairs as a single pipeline", () => {
    const repaired = repairLyricsV55(fixture("lyrics-v55-bad-no-tags.md"));
    expect(validateLyricsV55(repaired).valid).toBe(true);
  });
});
