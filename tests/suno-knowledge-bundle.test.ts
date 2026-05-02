import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const knowledgeDir = join(process.cwd(), "src", "suno-production", "knowledge");
const attribution = "<!-- Source: /Users/usedhonda/projects/docs/sunomanual (CC BY-NC 4.0, Copyright 2025-2026 usedhonda) -->";

const copiedKnowledgeFiles = [
  "lyric_craft.md",
  "song_structures.md",
  "style_catalog.md",
  "suno_v55_reference.md",
  "yaml_template.md",
  "english_lyrics.md",
  "rap_and_flow.md",
  "master_reference.md"
];

describe("Suno full knowledge bundle", () => {
  it("keeps the restored sunomanual files present with attribution headers", () => {
    for (const filename of copiedKnowledgeFiles) {
      const filePath = join(knowledgeDir, filename);
      expect(existsSync(filePath), filename).toBe(true);
      const contents = readFileSync(filePath, "utf8");
      expect(contents.startsWith(attribution), filename).toBe(true);
      expect(contents.split("\n").length, filename).toBeGreaterThan(50);
    }
  });

  it("includes the Phase A expansion files required by later prompt builders", () => {
    for (const filename of ["english_lyrics.md", "rap_and_flow.md", "master_reference.md"]) {
      const contents = readFileSync(join(knowledgeDir, filename), "utf8");
      expect(contents.length, filename).toBeGreaterThan(5_000);
    }
  });

  it("documents the CC BY-NC 4.0 bundle attribution in the knowledge README", () => {
    const readme = readFileSync(join(knowledgeDir, "README.md"), "utf8");
    expect(readme).toContain("CC BY-NC 4.0");
    expect(readme).toContain("Copyright");
    expect(readme).toContain("english_lyrics.md");
    expect(readme).toContain("rap_and_flow.md");
  });
});
