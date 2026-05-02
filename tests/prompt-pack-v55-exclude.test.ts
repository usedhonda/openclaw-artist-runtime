import { describe, expect, it } from "vitest";
import { buildExclude } from "../src/suno-production/buildExclude";
import {
  EXCLUDE_SYNTHESIS_KNOWLEDGE_REFERENCES,
  EXCLUDE_SYNTHESIS_SYSTEM_PROMPT,
  buildExcludeSynthesisPrompt
} from "../src/suno-production/excludeSynthesisPrompt";

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

  it("exposes mygpts-derived exclude synthesis prompt guidance with catalog attribution", () => {
    const prompt = buildExcludeSynthesisPrompt({
      genre: "nu-jazz",
      artistAvoid: ["stadium reverb"],
      voices: ["operator voice"]
    });

    expect(prompt.sourceAttribution).toContain("mygpts/style-analyzer/instructions.md");
    expect(EXCLUDE_SYNTHESIS_SYSTEM_PROMPT).toContain("2-5 items");
    expect(EXCLUDE_SYNTHESIS_SYSTEM_PROMPT).toContain("No \"no X\" phrasing");
    expect(EXCLUDE_SYNTHESIS_SYSTEM_PROMPT).toContain("style_catalog.md");
    expect(EXCLUDE_SYNTHESIS_KNOWLEDGE_REFERENCES).toContain("style_catalog.md");
    expect(prompt.user).toContain("nu-jazz");
  });
});
