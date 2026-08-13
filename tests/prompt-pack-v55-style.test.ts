import { describe, expect, it } from "vitest";
import {
  CANONICAL_STYLE_CORE_MAX_CHARS,
  CANONICAL_STYLE_HARD_MAX_CHARS,
  CANONICAL_STYLE_TARGET_MAX_CHARS,
  CANONICAL_STYLE_TARGET_MIN_CHARS,
  buildStyle,
  enforceStyleCoreContract
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

  it("keeps nu-jazz rap fallback bass electric unless upright is explicit", () => {
    const result = buildStyle({
      genre: "nu-jazz rap",
      moodHint: "tense underground hip-hop",
      brief: "Rhodes, live jazz drums, hard pick electric bass, no acoustic bass."
    });

    expect(result.total).toContain("thick electric bass");
    expect(result.total).not.toContain("fat upright bass");
    expect(result.total).not.toContain("upright bass");
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
      moodHint: "high-velocity progressive rap but still the same artist",
      brief: "Keep the current style, add high-velocity progressive architecture only as variation."
    });

    expect(result.total.length).toBeLessThanOrEqual(CANONICAL_STYLE_HARD_MAX_CHARS);
    expect(result.total).toContain("high-velocity progressive rap");
    expect(result.total).toContain("rapid section development");
  });

  it("uses the overt dopagaki variation when the prompt asks for strong exposure", () => {
    const result = buildStyle({
      genre: "nu-jazz rap",
      moodHint: "高速多展開プログレッシブ・ラップ強め, overt structural density, but keep the current artist",
      brief: "Expose the high-velocity progressive architecture clearly inside the nu-jazz rap frame."
    });

    expect(result.total.length).toBeLessThanOrEqual(CANONICAL_STYLE_HARD_MAX_CHARS);
    expect(result.total).toContain("overt high-velocity progressive rap");
    expect(result.total).toContain("metric displacement");
    expect(result.total).toContain("technical fast-flow bursts");
    expect(result.total).not.toContain("digital gloss");
    expect(result.coreTags).not.toContain(",,");
    expect(result.coreTags).not.toContain(" ,");
  });

  it("uses the overt dopagaki variation from the per-song variation seed", () => {
    const result = buildStyle({
      genre: "nu-jazz rap",
      moodHint: "aggressive urban critique",
      brief: "Keep the same low-bass artist core.",
      variationSeed: "dopagaki:overt:spawn_001"
    });

    expect(result.total).toContain("overt high-velocity progressive rap");
    expect(result.total).toContain("metric displacement");
    expect(result.total).not.toContain("generic digital gloss");
  });
});

// Mirrors the prompt-pack validator's styleCoreLine() to assert the repaired
// first content line satisfies the canonical core cap.
function firstContentLine(style: string): string {
  return style
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line && !/^#\s*Style\b/i.test(line))[0] ?? "";
}

describe("enforceStyleCoreContract", () => {
  it("leaves a compliant style untouched (core line <= cap)", () => {
    const core = "a".repeat(CANONICAL_STYLE_CORE_MAX_CHARS);
    const style = `# Style\n\n${core}\n- Genre & Era: nu-jazz rap`;
    expect(enforceStyleCoreContract(style)).toBe(style);
    expect(firstContentLine(enforceStyleCoreContract(style)).length).toBeLessThanOrEqual(CANONICAL_STYLE_CORE_MAX_CHARS);
  });

  it("repairs a first content line one char over the cap", () => {
    const over = Array.from({ length: 20 }, (_, i) => `tag${i}`).join(", ");
    expect(over.length).toBeGreaterThan(CANONICAL_STYLE_CORE_MAX_CHARS);
    const repaired = enforceStyleCoreContract(`# Style\n\n${over}`);
    expect(firstContentLine(repaired).length).toBeLessThanOrEqual(CANONICAL_STYLE_CORE_MAX_CHARS);
    expect(firstContentLine(repaired).length).toBeGreaterThan(0);
    // original run-on is preserved as a following body line, not discarded
    expect(repaired).toContain(over);
  });

  it("repairs a 931-char AI run-on first line into a fitted core line", () => {
    const runOn = Array.from({ length: 120 }, (_, i) => `dense descriptor phrase ${i}`).join(", ");
    expect(runOn.length).toBeGreaterThanOrEqual(900);
    const repaired = enforceStyleCoreContract(`# Style\n\n${runOn}\n- Mix Vision: bass forward`);
    const core = firstContentLine(repaired);
    expect(core.length).toBeLessThanOrEqual(CANONICAL_STYLE_CORE_MAX_CHARS);
    expect(core.length).toBeGreaterThan(0);
    expect(repaired.length).toBeLessThanOrEqual(CANONICAL_STYLE_HARD_MAX_CHARS);
  });

  it("falls back to a phrase-boundary slice when the run-on has no comma tags", () => {
    const runOn = "word ".repeat(300).trim();
    const repaired = enforceStyleCoreContract(`# Style\n\n${runOn}`);
    const core = firstContentLine(repaired);
    expect(core.length).toBeLessThanOrEqual(CANONICAL_STYLE_CORE_MAX_CHARS);
    expect(core.length).toBeGreaterThan(0);
  });
});
