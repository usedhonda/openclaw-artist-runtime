import { describe, expect, it } from "vitest";
import { buildStyle } from "../src/suno-production/buildStyle";

describe("Suno V5.5 style builder", () => {
  it("builds short core tags under 120 chars and total under 400 chars", () => {
    const result = buildStyle({
      genre: "nu-jazz rap",
      bpm: 132,
      key: "D minor",
      vibe: "civic dread",
      moodHint: "cold municipal pulse",
      instruments: ["upright bass", "brushed drums", "glass synth"],
      performanceDirection: "Keep the delivery close and restrained, with the hook carrying the repeated image instead of a big pop lift."
    });

    expect(result.coreTags.length).toBeLessThanOrEqual(120);
    expect(result.total.length).toBeLessThanOrEqual(400);
    expect(result.coreTags.startsWith("civic dread")).toBe(true);
    expect(result.coreTags).toContain("BPM 132");
    expect(result.coreTags).toContain("civic dread");
  });

  it("repairs prose-like style input into comma tags", () => {
    const result = buildStyle({
      brief: "A slow alternative pop song with warm bass and brushed drums.",
      moodHint: "observational dusk"
    });

    expect(result.coreTags).not.toMatch(/\.$/);
    expect(result.coreTags.split(",").length).toBeGreaterThanOrEqual(6);
  });
});
