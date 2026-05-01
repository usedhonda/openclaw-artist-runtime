import { describe, expect, it } from "vitest";
import { buildSliders } from "../src/suno-production/buildSliders";

describe("Suno V5.5 slider builder", () => {
  it("uses genre-aware defaults", () => {
    expect(buildSliders({ genre: "rap" })).toEqual({ weirdness: 40, styleInfluence: 75, audioInfluence: 25 });
    expect(buildSliders({ genre: "jazz" })).toEqual({ weirdness: 30, styleInfluence: 65, audioInfluence: 30 });
    expect(buildSliders({ genre: "edm" })).toEqual({ weirdness: 50, styleInfluence: 80, audioInfluence: 20 });
    expect(buildSliders({ genre: "pop" })).toEqual({ weirdness: 35, styleInfluence: 70, audioInfluence: 25 });
  });

  it("adjusts from mood hint and clamps all sliders to 15-85", () => {
    const sliders = buildSliders({ genre: "edm", moodHint: "surreal dread precise reference" });

    expect(sliders.weirdness).toBe(60);
    expect(sliders.styleInfluence).toBe(85);
    expect(sliders.audioInfluence).toBe(30);
    for (const value of Object.values(sliders)) {
      expect(value).toBeGreaterThanOrEqual(15);
      expect(value).toBeLessThanOrEqual(85);
    }
  });
});
