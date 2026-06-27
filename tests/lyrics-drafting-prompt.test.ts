import { describe, expect, it } from "vitest";
import {
  LYRICS_KNOWLEDGE_DIGEST_FILES,
  LYRICS_WRITER_SYSTEM_PROMPT,
  buildLyricsDraftingPrompt,
  readLyricsKnowledgeDigest
} from "../src/services/lyricsDraftingPrompt";

describe("lyrics drafting prompt", () => {
  it("embeds the attributed lyrics-writer instructions and expanded knowledge references", async () => {
    const prompt = buildLyricsDraftingPrompt({
      artistMd: "artist",
      currentState: "state",
      briefText: "brief",
      title: "Civic Dread",
      knowledgeDigest: "digest"
    });

    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("韻");
    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("伏線");
    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("情景");
    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("パターンA");
    expect(LYRICS_WRITER_SYSTEM_PROMPT).toContain("MIT");
    expect(prompt).toContain("rap_and_flow.md");
    expect(prompt).toContain("english_lyrics.md");
    expect(prompt).toContain("master_reference.md");
    expect(LYRICS_KNOWLEDGE_DIGEST_FILES).toContain("master_reference.md");

    const digest = await readLyricsKnowledgeDigest();
    expect(digest).toContain("## rap_and_flow.md");
    expect(digest).toContain("## english_lyrics.md");
    expect(digest).toContain("## master_reference.md");
  });
});
