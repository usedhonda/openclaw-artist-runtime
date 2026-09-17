import { describe, expect, it } from "vitest";
import {
  bpmForTempoBand,
  pickTempoBand,
  pickTempoBandAvoidingSlowRepeat
} from "../src/services/creativeVariationPolicy";
import { getDurationPlan, bandForBpm } from "../src/suno-production/durationPlan";
import { tempoWithinPlan } from "../src/services/songSpawnProposer";

describe("tempo policy", () => {
  it("centres the weighted pool on up and keeps the slow half around one song in ten", () => {
    const counts: Record<string, number> = {};
    for (let index = 0; index < 2000; index += 1) {
      const band = pickTempoBand(`song-${index}:seed`);
      counts[band] = (counts[band] ?? 0) + 1;
    }
    const share = (band: string) => (counts[band] ?? 0) / 2000;

    expect(share("up")).toBeGreaterThan(0.42);
    expect(share("up")).toBeLessThan(0.58);
    expect(share("slow") + share("mid")).toBeLessThan(0.16);
    expect(share("dopagaki") + share("super")).toBeGreaterThan(0.3);
  });

  it("never lets the slow half land twice in a row", () => {
    const slowSeeds = Array.from({ length: 400 }, (_, index) => `s-${index}`)
      .filter((seed) => ["slow", "mid"].includes(pickTempoBand(seed)));
    expect(slowSeeds.length).toBeGreaterThan(0);
    for (const seed of slowSeeds) {
      expect(pickTempoBandAvoidingSlowRepeat(seed, "slow")).toBe("up");
      expect(pickTempoBandAvoidingSlowRepeat(seed, "mid")).toBe("up");
      expect(["slow", "mid"]).toContain(pickTempoBandAvoidingSlowRepeat(seed, "up"));
    }
  });

  it("reads one BPM per band, from the duration plan", () => {
    for (const band of ["slow", "mid", "up", "dopagaki", "super"] as const) {
      expect(bpmForTempoBand(band)).toBe(getDurationPlan(band).bpm.target);
    }
    expect(bpmForTempoBand("up")).toBe(126);
  });

  it("falls back to the fast centre when a band cannot be resolved", () => {
    expect(getDurationPlan().bpm.target).toBe(126);
    expect(bandForBpm(127)).toBe("up");
  });

  it("keeps an AI brief tempo only when it sits inside the planned band", () => {
    expect(tempoWithinPlan("94 BPM", "126 BPM", "up")).toBe("126 BPM");
    expect(tempoWithinPlan("124 BPM", "126 BPM", "up")).toBe("124 BPM");
    expect(tempoWithinPlan("artist decides", "148 BPM", "dopagaki")).toBe("148 BPM");
    expect(tempoWithinPlan("", "126 BPM", "up")).toBe("126 BPM");
    expect(tempoWithinPlan("moody late night", "126 BPM", "up")).toBe("126 BPM");
  });
});

describe("fast-band arrangement policy", () => {
  it("drives the performance on fast bands and stays restrained on the slow half", async () => {
    const { performanceDirectionForBand } = await import("../src/suno-production/durationPlan");

    expect(performanceDirectionForBand("up")).toContain("Drive the pocket");
    expect(performanceDirectionForBand("dopagaki")).toContain("no instrumental display");
    expect(performanceDirectionForBand("mid")).toContain("restrained");
    expect(performanceDirectionForBand("slow")).toContain("no double-time vocal");
  });

  it("asks for displaced accents and an odd-meter turn only on fast bands", async () => {
    const { durationPlanProductionNotes, getDurationPlan: plan } = await import("../src/suno-production/durationPlan");

    expect(durationPlanProductionNotes(plan("up")).join(" ")).toContain("odd-meter");
    expect(durationPlanProductionNotes(plan("up")).join(" ")).toContain("displaced accents");
    expect(durationPlanProductionNotes(plan("mid")).join(" ")).not.toContain("odd-meter");
  });

  it("keeps brass and slow descriptors out of fast songs", async () => {
    const { buildExclude } = await import("../src/suno-production/buildExclude");

    const fast = buildExclude({ genre: "progressive rap", fastTempo: true }).items;
    // Horn punctuation is kept; the lead/pad use and the fusion drift are excluded.
    expect(fast).toContain("solo sax lead");
    expect(fast).toContain("horn section pad");
    expect(fast).not.toContain("horn stabs");
    expect(fast).toContain("slap bass");
    expect(fast).toContain("smooth jazz fusion");

    const slow = buildExclude({ genre: "progressive rap", fastTempo: false }).items;
    expect(slow).toContain("solo sax lead");
    expect(slow).not.toContain("slap bass");
    expect(slow).not.toContain("smooth jazz fusion");
  });
});
