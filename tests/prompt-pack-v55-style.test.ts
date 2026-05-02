import { describe, expect, it } from "vitest";
import { buildStyle } from "../src/suno-production/buildStyle";
import {
  STYLE_SYNTHESIS_KNOWLEDGE_REFERENCES,
  STYLE_SYNTHESIS_SYSTEM_PROMPT,
  buildStyleSynthesisPrompt
} from "../src/suno-production/styleSynthesisPrompt";

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

  it("extracts brief-specific instrument terms for fallback style tags", () => {
    const result = buildStyle({
      brief: "A midnight room-trio sketch built around Rhodes, sax, and upright bass.",
      moodHint: "blue municipal hush"
    });

    expect(result.coreTags).toContain("Rhodes");
    expect(result.coreTags).toContain("sax");
    expect(result.coreTags).toContain("upright bass");
  });

  it("exposes mygpts-derived style synthesis prompt guidance with catalog attribution", () => {
    const prompt = buildStyleSynthesisPrompt({
      brief: "Rhodes and sax move under a restrained vocal.",
      moodHint: "blue municipal hush"
    });

    expect(prompt.sourceAttribution).toContain("mygpts/style-analyzer/instructions.md");
    expect(STYLE_SYNTHESIS_SYSTEM_PROMPT).toContain("Performance direction");
    expect(STYLE_SYNTHESIS_SYSTEM_PROMPT).toContain("meta.vibe appears verbatim");
    expect(STYLE_SYNTHESIS_SYSTEM_PROMPT).toContain("style_catalog.md");
    expect(STYLE_SYNTHESIS_KNOWLEDGE_REFERENCES).toContain("style_catalog.md");
    expect(prompt.user).toContain("Rhodes and sax");
  });
});
