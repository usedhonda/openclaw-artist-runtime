import { describe, expect, it } from "vitest";
import { buildExclude } from "../src/suno-production/buildExclude";

describe("Suno V5.5 exclude builder", () => {
  it("keeps 2-5 safe items under 200 chars", () => {
    const result = buildExclude({
      genre: "nu-jazz",
      artistAvoid: ["stadium reverb", "fake crowd noise"],
      voices: ["operator voice"]
    });

    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items.length).toBeLessThanOrEqual(5);
    expect(result.text.length).toBeLessThanOrEqual(200);
    expect(result.text).toContain("festival EDM drop");
  });

  it("removes copyright source names from exclude text", () => {
    const result = buildExclude({
      artistAvoid: ["Drake vocal clone", "muddy master"],
      copyrightSourceNameDenylist: ["Drake"]
    });

    expect(result.text).not.toMatch(/Drake/i);
    expect(result.text).toContain("muddy master");
  });
});
