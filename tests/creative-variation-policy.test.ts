import { describe, expect, it } from "vitest";
import {
  DOPAGAKI_TARGET_RATE,
  decideDopagakiVariation,
  dopagakiPromptLines,
  emotionalModesFromArtist,
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
