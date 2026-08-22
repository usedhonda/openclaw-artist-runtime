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

  it("injects the persona critique lens and bounded dopagaki mode", () => {
    const activePrompt = buildLyricsDraftingPrompt({
      artistMd: "## Artist Core\n渋谷への怒り。対象は人でなく都市の仕組み。",
      currentState: "",
      briefText: [
        "## Direction",
        "- Lyrics theme: ニュースを渋谷の再開発へ折り返す",
        "## Frozen sources",
        "- news: https://example.test/news — 便利さが安全を薄める",
        "- x_reaction: https://x.com/city/status/123 — 限界だと思う"
      ].join("\n"),
      title: "Shibuya Ledger",
      knowledgeDigest: "",
      dopagakiVariation: {
        active: true,
        intensity: "overt",
        score: 0.1,
        threshold: 0.4,
        variationSeed: "dopagaki:overt:test"
      }
    });
    const inactivePrompt = buildLyricsDraftingPrompt({
      artistMd: "## Artist Core\n渋谷への怒り。",
      currentState: "",
      briefText: "brief",
      title: "Plain Ledger",
      knowledgeDigest: "",
      dopagakiVariation: {
        active: false,
        intensity: "off",
        score: 0.8,
        threshold: 0.4,
        variationSeed: "spacious:test"
      }
    });

    expect(activePrompt).toContain("Critique lens");
    expect(activePrompt).toContain("Do not attack private individuals");
    expect(activePrompt).toContain("High-velocity progressive rap: ACTIVE / OVERT");
    expect(activePrompt).toContain("2-4 bar bursts");
    expect(activePrompt).toContain("Keep live breakbeat jazz drums, thick electric bass, Rhodes");
    expect(inactivePrompt).toContain("core motion is always active; overt density mode is inactive");
    expect(inactivePrompt).toContain("rapid section development");
    expect(inactivePrompt).not.toContain("default spacious rap pacing");
  });

  it("keeps live-sized persona rules and truncates only before a section", () => {
    const artistMd = [
      `## Artist Core\n${"核".repeat(4100)}`,
      "## Avoid\n- 既存曲の焼き直しをしない。",
      "## Anti-mannerism\n- 決まり文句で感情を説明しない。",
      "### Signature section logic\n- フックはヴァースの景色を反転して回収する。"
    ].join("\n\n").padEnd(10871, "余") + `\n\n## Overflow\n${"溢".repeat(1800)}`;

    const prompt = buildLyricsDraftingPrompt({
      artistMd,
      currentState: "",
      briefText: "brief",
      title: "Persona Rules",
      knowledgeDigest: ""
    });

    expect(prompt).toContain("## Avoid");
    expect(prompt).toContain("## Anti-mannerism");
    expect(prompt).toContain("### Signature section logic");
    expect(prompt).toContain("[… persona truncated at section boundary …]");
    expect(prompt).not.toContain("## Overflow");
  });
});
