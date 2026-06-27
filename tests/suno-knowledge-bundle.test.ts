import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_BUNDLE,
  KNOWLEDGE_FILES,
  type KnowledgeFile
} from "../src/suno-production/knowledge-bundle.js";

const knowledgeDir = join(process.cwd(), "src", "suno-production", "knowledge");
const attribution = "<!-- Source: sunomanual (MIT, Copyright 2025-2026 usedhonda) -->";

const expectedKnowledgeFiles: readonly KnowledgeFile[] = [
  "README.md",
  "english_lyrics.md",
  "lyric_craft.md",
  "master_reference.md",
  "rap_and_flow.md",
  "song_structures.md",
  "style_catalog.md",
  "suno_v55_reference.md",
  "yaml_template.md"
];

describe("Suno full knowledge bundle", () => {
  it("ships every sunomanual file as inline TypeScript constants", () => {
    expect([...KNOWLEDGE_FILES].sort()).toEqual([...expectedKnowledgeFiles].sort());
    for (const filename of KNOWLEDGE_FILES) {
      const inline = KNOWLEDGE_BUNDLE[filename];
      expect(inline, filename).toBeTruthy();
      expect(inline.length, filename).toBeGreaterThan(0);
    }
  });

  it("keeps the .md sources on disk so build-knowledge-bundle --write can regenerate", () => {
    for (const filename of KNOWLEDGE_FILES) {
      const filePath = join(knowledgeDir, filename);
      expect(existsSync(filePath), filename).toBe(true);
    }
  });

  it("preserves attribution headers in inline content (excluding README)", () => {
    const filesWithAttribution = KNOWLEDGE_FILES.filter((name) => name !== "README.md");
    for (const filename of filesWithAttribution) {
      const inline = KNOWLEDGE_BUNDLE[filename];
      expect(inline.startsWith(attribution), filename).toBe(true);
      expect(inline.split("\n").length, filename).toBeGreaterThan(50);
    }
  });

  it("matches inline content to the .md source byte-for-byte (idempotency)", () => {
    for (const filename of KNOWLEDGE_FILES) {
      const onDisk = readFileSync(join(knowledgeDir, filename), "utf8");
      const inline = KNOWLEDGE_BUNDLE[filename];
      expect(inline, filename).toBe(onDisk);
    }
  });

  it("includes the Phase A expansion files at full depth", () => {
    for (const filename of ["english_lyrics.md", "rap_and_flow.md", "master_reference.md"] as const) {
      const inline = KNOWLEDGE_BUNDLE[filename];
      expect(inline.length, filename).toBeGreaterThan(5_000);
    }
    expect(KNOWLEDGE_BUNDLE["master_reference.md"].length).toBeGreaterThan(50_000);
  });

  it("documents the MIT bundle attribution in the knowledge README", () => {
    const readme = KNOWLEDGE_BUNDLE["README.md"];
    expect(readme).toContain("MIT");
    expect(readme).toContain("Copyright");
    expect(readme).toContain("english_lyrics.md");
    expect(readme).toContain("rap_and_flow.md");
  });
});
