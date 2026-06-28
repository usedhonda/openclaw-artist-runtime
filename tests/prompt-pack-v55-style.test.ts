import { describe, expect, it } from "vitest";
import {
  CANONICAL_STYLE_CORE_MAX_CHARS,
  CANONICAL_STYLE_HARD_MAX_CHARS,
  CANONICAL_STYLE_TARGET_MAX_CHARS,
  CANONICAL_STYLE_TARGET_MIN_CHARS,
  buildStyle
} from "../src/suno-production/buildStyle";
import {
  STYLE_SYNTHESIS_KNOWLEDGE_REFERENCES,
  STYLE_SYNTHESIS_SYSTEM_PROMPT,
  buildStyleSynthesisPrompt
} from "../src/suno-production/styleSynthesisPrompt";

describe("Suno V5.5 style builder", () => {
  it("builds canonical rich style guidance with genre and mood anchors", () => {
    const result = buildStyle({
      genre: "nu-jazz rap",
      bpm: 132,
      key: "D minor",
      vibe: "civic dread",
      moodHint: "cold municipal pulse",
      instruments: ["upright bass", "brushed drums", "glass synth"],
      performanceDirection: "Keep the delivery close and restrained, with the hook carrying the repeated image instead of a big pop lift."
    });

    expect(result.coreTags.length).toBeLessThanOrEqual(CANONICAL_STYLE_CORE_MAX_CHARS);
    expect(result.total.length).toBeGreaterThanOrEqual(CANONICAL_STYLE_TARGET_MIN_CHARS);
    expect(result.total.length).toBeLessThanOrEqual(CANONICAL_STYLE_TARGET_MAX_CHARS);
    expect(result.coreTags.startsWith("nu-jazz rap")).toBe(true);
    expect(result.coreTags).toContain("BPM 132");
    expect(result.coreTags).toContain("civic dread");
    expect(result.total.startsWith("# Style\n")).toBe(true);
    expect(result.total).toContain("nu-jazz rap");
    expect(result.total).toContain("Instruments");
    expect(result.total).toContain("Texture");
    expect(result.total).toContain("Performance");
    expect(result.total).toContain("Variation Move");
    expect(result.total).not.toContain("Knowledge Vocabulary");
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
  ])("renders canonical template for %s", (genre, vibe) => {
    const result = buildStyle({ genre, vibe, moodHint: vibe });

    expect(result.total.length).toBeGreaterThanOrEqual(CANONICAL_STYLE_TARGET_MIN_CHARS);
    expect(result.total.length).toBeLessThanOrEqual(CANONICAL_STYLE_TARGET_MAX_CHARS);
    expect(result.coreTags.length).toBeLessThanOrEqual(CANONICAL_STYLE_CORE_MAX_CHARS);
    expect(result.total.startsWith("# Style\n")).toBe(true);
    expect(result.total).toContain(genre);
    expect(result.total).toContain(vibe);
    expect(result.total).not.toContain("Knowledge Vocabulary");
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
    expect(prompt.user).toContain("Target 760-900 characters");
    expect(prompt.system).toContain("hard <=1000 chars");
    expect(prompt.system).not.toContain("total <=400 characters");
    expect(prompt.user).not.toContain("total target <=400 characters");
  });

  it("forces the dopagaki variation profile when the brief asks for it", () => {
    const result = buildStyle({
      genre: "alternative pop",
      moodHint: "ドパガキ強め but still the same artist",
      brief: "Keep the current style, add dopagaki pressure only as variation."
    });

    expect(result.total.length).toBeLessThanOrEqual(CANONICAL_STYLE_HARD_MAX_CHARS);
    expect(result.total).toContain("dopamine-pop pressure");
    expect(result.total).toContain("cold-open hook energy");
  });
});
