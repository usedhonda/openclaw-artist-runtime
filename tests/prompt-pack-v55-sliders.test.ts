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

  it("replaces weirdness with the override and leaves style/audio untouched", () => {
    const base = buildSliders({ genre: "rap" });
    const overridden = buildSliders({ genre: "rap", weirdnessOverride: 80 });

    expect(base.weirdness).toBe(40);
    expect(overridden.weirdness).toBe(80);
    expect(overridden.styleInfluence).toBe(base.styleInfluence);
    expect(overridden.audioInfluence).toBe(base.audioInfluence);
  });

  it("clamps a high override into the 15-85 safe zone", () => {
    expect(buildSliders({ genre: "rap", weirdnessOverride: 100 }).weirdness).toBe(85);
    expect(buildSliders({ genre: "rap", weirdnessOverride: 0 }).weirdness).toBe(15);
  });
});
