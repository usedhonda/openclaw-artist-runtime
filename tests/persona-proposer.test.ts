import { describe, expect, it } from "vitest";
import {
  buildPersonaProposerPrompt,
  isPersonaAppendOnly,
  parsePersonaProposerResponse,
  proposePersonaFields
} from "../src/services/personaProposer";
import type { PersonaField } from "../src/types";

const allFields: PersonaField[] = [
  "artistName",
  "identityLine",
  "soundDna",
  "obsessions",
  "lyricsRules",
  "socialVoice",
  "soul-tone",
  "soul-refusal"
];

describe("persona proposer", () => {
  it("returns deterministic default drafts for the mock provider", async () => {
    const result = await proposePersonaFields({
      fields: allFields,
      source: { artistMd: "", soulMd: "", roughInput: "rough artist sketch" }
    });

    expect(result.provider).toBe("mock");
    expect(result.warnings).toEqual([]);
    expect(result.drafts).toHaveLength(8);
    expect(result.drafts.find((draft) => draft.field === "artistName")).toMatchObject({
      draft: "Unnamed OpenClaw Artist",
      status: "proposed"
    });
    expect(result.drafts.find((draft) => draft.field === "soul-refusal")).toMatchObject({
      draft: "Refuse weak or unsafe ideas with a clear reason and one stronger alternative.",
      status: "proposed"
    });
  });

  it("skips only the field that contains secret-like rough input", async () => {
    const result = await proposePersonaFields({
      fields: ["artistName", "socialVoice"],
      source: {
        artistMd: "",
        soulMd: "",
        roughInput: ["artistName: used::honda", `socialVoice: ${["TELEGRAM", "BOT", "TOKEN"].join("_")}=do-not-store`].join(
          "\n"
        )
      }
    });

    expect(result.warnings.join("\n")).toContain("socialVoice");
    expect(result.drafts.find((draft) => draft.field === "artistName")).toMatchObject({
      status: "proposed",
      draft: "Unnamed OpenClaw Artist"
    });
    expect(result.drafts.find((draft) => draft.field === "socialVoice")).toMatchObject({
      status: "skipped",
      draft: ""
    });
  });

  it("includes raw artist context and custom section names in the prompt", () => {
    const prompt = buildPersonaProposerPrompt({
      fields: ["obsessions"],
      source: {
        artistMd: "## 人物像\n\n都市の皮肉を歌う。",
        soulMd: "## Voice\n\n短い返答。",
        customSections: ["人物像", "音楽的ルーツ"]
      }
    });

    expect(prompt).toContain("Requested fields: obsessions");
    expect(prompt).toContain("人物像, 音楽的ルーツ");
    expect(prompt).toContain("都市の皮肉");
  });

  it("parses provider responses using persona field aliases", () => {
    const drafts = parsePersonaProposerResponse(
      [
        "voice: short and sharp (origin: custom Voice section)",
        "conversation tone: blunt but loyal (origin: SOUL body)",
        "themes: satire and infrastructure (origin: Lyrics)"
      ].join("\n"),
      ["socialVoice", "soul-tone", "obsessions"]
    );

    expect(drafts).toEqual([
      { field: "socialVoice", draft: "short and sharp", reasoning: "custom Voice section", status: "proposed" },
      { field: "soul-tone", draft: "blunt but loyal", reasoning: "SOUL body", status: "proposed" },
      { field: "obsessions", draft: "satire and infrastructure", reasoning: "Lyrics", status: "proposed" }
    ]);
  });

  it("marks a field skipped when provider response contains secret-like text", () => {
    const drafts = parsePersonaProposerResponse(
      `socialVoice: ${["TELEGRAM", "BOT", "TOKEN"].join("_")}=do-not-store (origin: unsafe response)`,
      ["socialVoice"]
    );

    expect(drafts[0]).toMatchObject({
      field: "socialVoice",
      status: "skipped",
      reasoning: "unsafe response"
    });
  });

  it("uses motif-anchored mock drafts for soul-tone and soul-refusal when ARTIST.md has motifs", async () => {
    const artistMd = [
      "## Lyrics",
      "- テーマ: 社会風刺、皮肉、権力構造",
      "- 避けること:",
      "  - 自己紹介",
      "  - 感情語連打",
      "  - 説明口調"
    ].join("\n");
    const result = await proposePersonaFields({
      fields: ["soul-tone", "soul-refusal", "artistName"],
      source: { artistMd, soulMd: "" }
    });

    expect(result.provider).toBe("mock");
    const tone = result.drafts.find((draft) => draft.field === "soul-tone");
    expect(tone?.status).toBe("proposed");
    expect(tone?.draft).toContain("社会風刺");
    expect(tone?.reasoning).toContain("motifs");
    const refusal = result.drafts.find((draft) => draft.field === "soul-refusal");
    expect(refusal?.draft).toContain("自己紹介");
    expect(refusal?.draft).toContain("受け流す");
    const name = result.drafts.find((draft) => draft.field === "artistName");
    expect(name?.draft).toBe("Unnamed OpenClaw Artist");
  });

  it("includes the persona motif anchor in the AI prompt when ARTIST.md has motifs", () => {
    const prompt = buildPersonaProposerPrompt({
      fields: ["soul-tone"],
      source: {
        artistMd: "## Lyrics\n- テーマ: 社会風刺と再開発の矛盾\n- 地理的スタンス: 渋谷、六本木",
        soulMd: ""
      }
    });

    expect(prompt).toContain("Persona motifs (anchor):");
    expect(prompt).toContain("社会風刺");
  });

  describe("append-only guard (Plan v10.10)", () => {
    it("activates append-only mode when persona files exceed the density threshold", () => {
      const dense = "x".repeat(6000);
      expect(isPersonaAppendOnly(dense, "")).toBe(true);
      expect(isPersonaAppendOnly("", dense)).toBe(true);
      expect(isPersonaAppendOnly("a".repeat(3000), "b".repeat(3000))).toBe(true);
    });

    it("stays in normal mode when persona files are below the density threshold", () => {
      expect(isPersonaAppendOnly("", "")).toBe(false);
      expect(isPersonaAppendOnly("short soul", "short artist")).toBe(false);
      expect(isPersonaAppendOnly("a".repeat(2000), "b".repeat(2000))).toBe(false);
    });

    it("skips every requested field when persona files are dense, with append-only reasoning", async () => {
      const denseSoul = "## SOUL.md\n\n" + "用途は試験。文字を埋めるだけ。\n".repeat(400);
      const result = await proposePersonaFields({
        fields: allFields,
        source: { artistMd: "", soulMd: denseSoul }
      });

      expect(result.warnings.some((w) => w.includes("append-only"))).toBe(true);
      expect(result.drafts).toHaveLength(allFields.length);
      for (const draft of result.drafts) {
        expect(draft.status).toBe("skipped");
        expect(draft.draft).toBe("");
        expect(draft.reasoning).toContain("append-only");
      }
    });
  });
});
