import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateLineCount,
  validateLyricsV55,
  validateMetatagPresence,
  validateNoCommandLeak,
  validateNoCopyrightSourceName,
  validateSectionCount
} from "../src/services/lyricsValidator";

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");
}

describe("lyrics V5.5 validator", () => {
  it("accepts a tagged 8-section lyric fixture", () => {
    const result = validateLyricsV55(fixture("lyrics-v55-good.md"), { denylist: ["Drake"] });
    expect(result.valid).toBe(true);
    expect(result.sections).toHaveLength(8);
  });

  it("detects missing metatags and section count drift", () => {
    const lyrics = fixture("lyrics-v55-bad-no-tags.md");
    expect(validateMetatagPresence(lyrics).map((issue) => issue.code)).toContain("missing_metatag");
    expect(validateSectionCount(lyrics).map((issue) => issue.code)).toContain("section_count");
  });

  it("detects line count violations", () => {
    expect(validateLineCount(fixture("lyrics-v55-bad-too-short.md")).map((issue) => issue.code)).toContain("line_count");
  });

  it("detects command-like prompt leakage outside tags", () => {
    expect(validateNoCommandLeak(fixture("lyrics-v55-bad-command-leak.md")).map((issue) => issue.code)).toContain("command_leak");
  });

  it("detects blocked source names", () => {
    expect(validateNoCopyrightSourceName(fixture("lyrics-v55-bad-copyright.md"), ["Drake"]).map((issue) => issue.code)).toContain("copyright_source_name");
  });
});
