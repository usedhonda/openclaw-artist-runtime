import { describe, expect, it } from "vitest";
import {
  DOPAGAKI_TARGET_RATE,
  decideDopagakiVariation,
  dopagakiPromptLines,
  emotionalModesFromArtist,
  parseCritiqueLenses,
  parseSignatures,
  pickEmotionalMode,
  pickTempoBand
} from "../src/services/creativeVariationPolicy";

describe("creative variation policy", () => {
  it("selects dopagaki deterministically around the target rate", () => {
    const decisions = Array.from({ length: 100 }, (_, index) =>
      decideDopagakiVariation({
        songId: `spawn_${index}`,
        date: "2026-07-01",
        observationText: `news observation ${index}`,
        briefText: `brief ${index}`
      })
    );
    const activeCount = decisions.filter((decision) => decision.active).length;

    expect(DOPAGAKI_TARGET_RATE).toBe(0.4);
    expect(activeCount).toBeGreaterThanOrEqual(30);
    expect(activeCount).toBeLessThanOrEqual(50);
    expect(decideDopagakiVariation({ songId: "stable", briefText: "same" })).toEqual(
      decideDopagakiVariation({ songId: "stable", briefText: "same" })
    );
  });

  it("biases away from long spacious runs without making the choice random", () => {
    const neutral = decideDopagakiVariation({
      songId: "bias-check",
      briefText: "same source"
    });
    const biased = decideDopagakiVariation({
      songId: "bias-check",
      briefText: "same source",
      recentModes: ["spacious", "spacious", "spacious"]
    });

    expect(biased.threshold).toBeGreaterThan(neutral.threshold);
    expect(biased.score).toBe(neutral.score);
  });

  it("keeps overt mode bounded to short bursts", () => {
    const lines = dopagakiPromptLines({
      active: true,
      intensity: "overt",
      score: 0.1,
      threshold: 0.4,
      variationSeed: "dopagaki:overt:test"
    }).join("\n");

    expect(lines).toContain("High-velocity progressive rap: ACTIVE / OVERT");
    expect(lines).toContain("2-4 bar bursts");
    expect(lines).toContain("Never turn the full song into double-time");
    expect(lines).toContain("metric displacement");
    expect(lines).toContain("transformed hook returns");
    expect(lines).not.toMatch(/dopagaki|dopamine|high stimulus|instant hook/i);
  });

  it("uses persona modes and rotates tempo deterministically", () => {
    const modes = emotionalModesFromArtist("### Emotional Modes\n- 郷愁: nostalgic, warm-cold\n- 祝祭: celebratory, bright\n");
    expect(pickEmotionalMode("song-1", modes).mood).toMatch(/nostalgic|celebratory/);
    const bands = new Set(Array.from({ length: 40 }, (_, index) => pickTempoBand(`song-${index}`)));
    expect(bands).toEqual(new Set(["slow", "mid", "up", "dopagaki", "super"]));
  });
});

describe("parseCritiqueLenses", () => {
  it("parses bracketed-id bullets into id/label/description", () => {
    const persona = [
      "### Critique Lens",
      "",
      "- [culture_watch] Culture Watch: track trends before judging them.",
      "- [self_reflection] Self Reflection: turn the lens on the narrator too."
    ].join("\n");
    expect(parseCritiqueLenses(persona)).toEqual([
      { id: "culture_watch", label: "Culture Watch", description: "track trends before judging them." },
      { id: "self_reflection", label: "Self Reflection", description: "turn the lens on the narrator too." }
    ]);
  });

  it("ignores prose bullets that carry no bracketed id, without breaking the lens bullets around them", () => {
    const persona = [
      "### Critique Lens",
      "",
      "- Start from the material and follow the systems.",
      "- [culture_watch] Culture Watch: track trends before judging them.",
      "- The diss target is systems, not people."
    ].join("\n");
    expect(parseCritiqueLenses(persona)).toEqual([
      { id: "culture_watch", label: "Culture Watch", description: "track trends before judging them." }
    ]);
  });

  it("returns [] when the section is absent", () => {
    expect(parseCritiqueLenses("# empty persona\n")).toEqual([]);
  });

  it("stops at the next heading and never reads bullets from a later section", () => {
    const persona = [
      "### Critique Lens",
      "",
      "- [culture_watch] Culture Watch: track trends before judging them.",
      "",
      "### Emotional Modes",
      "",
      "- [not_a_lens] should not appear: this section is not Critique Lens."
    ].join("\n");
    expect(parseCritiqueLenses(persona)).toEqual([
      { id: "culture_watch", label: "Culture Watch", description: "track trends before judging them." }
    ]);
  });
});

describe("parseSignatures", () => {
  it("splits a comma-separated Signature bullet into values", () => {
    const persona = "## Current Artist Core\n\n- Signature: the receipt, the price behind the price, the tell\n";
    expect(parseSignatures(persona)).toEqual(["the receipt", "the price behind the price", "the tell"]);
  });

  it("accepts slash-joined values in the same bullet", () => {
    const persona = "- Signature: 値段の裏側/舞台裏の視界/高さと時間帯";
    expect(parseSignatures(persona)).toEqual(["値段の裏側", "舞台裏の視界", "高さと時間帯"]);
  });

  it("reads indented sub-bullets as the values when the Signature line is guidance", () => {
    const persona = [
      "- Signature: show it through the point of view; keep at least one per song.",
      "  - the receipt: who paid and who profited",
      "  - the backstage view: PR, sponsors, contracts",
      "  - the hour and height: late night, looking down",
      "- Emotional weather: dry"
    ].join("\n");
    expect(parseSignatures(persona)).toEqual(["the receipt", "the backstage view", "the hour and height"]);
  });

  it("returns [] when no Signature bullet exists anywhere in the persona", () => {
    expect(parseSignatures("# empty persona\n- Signature subjects: TBD\n")).toEqual([]);
  });
});
