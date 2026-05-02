import { describe, expect, it } from "vitest";
import { synthesizeExclude } from "../src/suno-production/buildExclude";
import {
  EXCLUDE_SYNTHESIS_KNOWLEDGE_REFERENCES,
  EXCLUDE_SYNTHESIS_SYSTEM_PROMPT,
  buildExcludeSynthesisPrompt
} from "../src/suno-production/excludeSynthesisPrompt";

describe("exclude synthesis prompt", () => {
  it("carries style-analyzer guidance for safe exclude synthesis", () => {
    const prompt = buildExcludeSynthesisPrompt({
      genre: "nu-jazz rap",
      artistAvoid: ["stadium reverb"],
      voices: ["operator voice"]
    });

    expect(prompt.sourceAttribution).toContain("mygpts/style-analyzer/instructions.md");
    expect(EXCLUDE_SYNTHESIS_SYSTEM_PROMPT).toContain("2-5 items");
    expect(EXCLUDE_SYNTHESIS_SYSTEM_PROMPT).toContain("No \"no X\" phrasing");
    expect(EXCLUDE_SYNTHESIS_SYSTEM_PROMPT).toContain("style_catalog.md");
    expect(EXCLUDE_SYNTHESIS_SYSTEM_PROMPT).toContain("CC BY-NC 4.0");
    expect(EXCLUDE_SYNTHESIS_KNOWLEDGE_REFERENCES).toContain("master_reference.md");
    expect(prompt.user).toContain("nu-jazz rap");
  });

  it("falls back to deterministic exclude items in mock mode", async () => {
    const result = await synthesizeExclude({
      genre: "nu-jazz",
      artistAvoid: ["stadium reverb"]
    }, { provider: "mock" });

    expect(result.text).toContain("stadium reverb");
    expect(result.text).toContain("festival EDM drop");
  });
});
