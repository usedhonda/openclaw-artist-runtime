import { describe, expect, it } from "vitest";
import { synthesizeStyle } from "../src/suno-production/buildStyle";
import {
  STYLE_ANALYZER_SYSTEM_PROMPT,
  STYLE_SYNTHESIS_KNOWLEDGE_REFERENCES,
  buildStyleSynthesisPrompt
} from "../src/suno-production/styleSynthesisPrompt";

describe("style synthesis prompt", () => {
  it("carries the attributed style-analyzer source and style catalog references", () => {
    const prompt = buildStyleSynthesisPrompt({
      brief: "nu-jazz rap with Rhodes, sax, upright bass, and dissonant room tone",
      moodHint: "blue municipal hush"
    });

    expect(prompt.sourceAttribution).toContain("mygpts/style-analyzer/instructions.md");
    expect(STYLE_ANALYZER_SYSTEM_PROMPT).toContain("Suno Style Analyzer V5.5");
    expect(STYLE_ANALYZER_SYSTEM_PROMPT).toContain("Performance direction");
    expect(STYLE_ANALYZER_SYSTEM_PROMPT).toContain("style_catalog.md");
    expect(STYLE_ANALYZER_SYSTEM_PROMPT).toContain("CC BY-NC 4.0");
    expect(STYLE_SYNTHESIS_KNOWLEDGE_REFERENCES).toContain("style_catalog.md");
    expect(STYLE_SYNTHESIS_KNOWLEDGE_REFERENCES).toContain("master_reference.md");
    expect(prompt.user).toContain("Rhodes, sax, upright bass");
  });

  it("falls back to deterministic style tags in mock mode while preserving brief instruments", async () => {
    const result = await synthesizeStyle({
      brief: "nu-jazz rap with Rhodes, sax, upright bass, and dissonant room tone",
      moodHint: "blue municipal hush"
    }, { provider: "mock" });

    expect(result.coreTags).toContain("Rhodes");
    expect(result.coreTags).toContain("sax");
    expect(result.coreTags).toContain("upright bass");
  });
});
