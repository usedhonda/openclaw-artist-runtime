import { describe, expect, it } from "vitest";
import { buildStyle } from "../src/suno-production/buildStyle";
import {
  STYLE_SYNTHESIS_KNOWLEDGE_REFERENCES,
  STYLE_SYNTHESIS_SYSTEM_PROMPT,
  buildStyleSynthesisPrompt
} from "../src/suno-production/styleSynthesisPrompt";

describe("Suno V5.5 style builder", () => {
  it("builds dense style guidance with short core tags and vibe anchors", () => {
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
    expect(result.total.length).toBeGreaterThanOrEqual(800);
    expect(result.total.length).toBeLessThanOrEqual(1000);
    expect(result.coreTags.startsWith("civic dread")).toBe(true);
    expect(result.coreTags).toContain("BPM 132");
    expect(result.coreTags).toContain("civic dread");
    expect(result.total.startsWith("# Style\n\ncivic dread")).toBe(true);
    expect(result.total.endsWith("civic dread")).toBe(true);
    expect(result.total).toContain("Genre & Era");
    expect(result.total).toContain("Instruments");
    expect(result.total).toContain("Mix Vision");
    expect(result.total).toContain("Texture");
    expect(result.total).toContain("Vocal Production");
    expect(result.total).toContain("Arrangement Notes");
    expect(result.total).toContain("Performance Direction");
    expect(result.total).toContain("Knowledge Vocabulary");
    expect(result.total).toContain("wide stereo");
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

  it.each([
    ["nu-jazz rap", "blue civic pressure"],
    ["alternative pop", "rain-lit apartment tension"],
    ["edm", "cold warehouse pulse"],
    ["post-punk", "concrete hallway dread"],
    ["rap", "dry street sarcasm"]
  ])("renders dense template for %s", (genre, vibe) => {
    const result = buildStyle({ genre, vibe, moodHint: vibe });

    expect(result.total.length).toBeGreaterThanOrEqual(800);
    expect(result.total.length).toBeLessThanOrEqual(1000);
    expect(result.coreTags.length).toBeLessThanOrEqual(120);
    expect(result.total.startsWith(`# Style\n\n${vibe}`)).toBe(true);
    expect(result.total.endsWith(vibe)).toBe(true);
    expect(result.total).toContain("Knowledge Vocabulary");
  });

  it("exposes mygpts-derived style synthesis prompt guidance with catalog attribution", async () => {
    const prompt = await buildStyleSynthesisPrompt({
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
