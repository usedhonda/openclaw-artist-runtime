import { describe, expect, it } from "vitest";
import {
  INTRO_ARCHETYPE_IDS,
  resolveIntroVariant
} from "../src/services/creativeVariationPolicy";
import { getDurationPlan } from "../src/suno-production/durationPlan";

describe("resolveIntroVariant", () => {
  it("is deterministic: same seed yields the same variant", () => {
    const seed = "intro:song-42\n- Tempo: 126 BPM";
    const a = resolveIntroVariant(seed);
    const b = resolveIntroVariant(seed);
    expect(a).toEqual(b);
  });

  it("covers all seven archetypes across many seeds", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      seen.add(resolveIntroVariant(`intro:song-${i}\nbrief ${i}`).id);
    }
    expect([...seen].sort()).toEqual([...INTRO_ARCHETYPE_IDS].sort());
    expect(seen.size).toBe(7);
  });

  it("excludes the most recent archetype when recentArchetypes is provided", () => {
    // For any seed, passing that seed's own natural pick as the recent archetype
    // must produce a different archetype id (avoids repeating the previous song).
    for (let i = 0; i < 500; i += 1) {
      const seed = `intro:song-${i}\nbrief ${i}`;
      const natural = resolveIntroVariant(seed).id;
      const avoided = resolveIntroVariant(seed, [natural]).id;
      expect(avoided).not.toBe(natural);
      expect(INTRO_ARCHETYPE_IDS).toContain(avoided);
    }
  });

  it("avoids the recent entry mode as well as the two latest archetypes", () => {
    for (let i = 0; i < 500; i += 1) {
      const seed = `intro:entry-mode-${i}`;
      const first = resolveIntroVariant(seed);
      const second = resolveIntroVariant(`${seed}:next`, [first.id]);
      const third = resolveIntroVariant(`${seed}:third`, [first.id, second.id]);
      expect(second.id).not.toBe(first.id);
      expect(second.entryMode).not.toBe(first.entryMode);
      expect(third.id).not.toBe(first.id);
      expect(third.id).not.toBe(second.id);
    }
  });

  it("keeps every archetype internally coherent", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      const v = resolveIntroVariant(`intro:coh-${i}`);
      ids.add(v.id);
      expect(v.bars).toBeGreaterThan(0);
      expect(v.lineFloor).toBeGreaterThanOrEqual(0);
      expect(v.lineTarget.length).toBeGreaterThan(0);
      expect(v.modifier.length).toBeGreaterThan(0);
      expect(v.lyricInstruction.length).toBeGreaterThan(0);
      expect(v.styleMove.length).toBeGreaterThan(0);
    }
    expect(ids.size).toBe(7);
  });
});

describe("getDurationPlan intro override", () => {
  it("returns the shared band constant by reference with no opts (backward compatible)", () => {
    expect(getDurationPlan("mid")).toBe(getDurationPlan("mid"));
    expect(getDurationPlan()).toBe(getDurationPlan("mid"));
    expect(getDurationPlan("up")).toBe(getDurationPlan("up"));
  });

  it("replaces only the intro section and leaves other sections intact", () => {
    const base = getDurationPlan("mid");
    const override = {
      bars: 2,
      lineFloor: 0,
      lineTarget: "0 lines",
      modifier: "2 bars, cold open, hard entry, no runway",
      lyricInstruction: "0 lines; enter immediately at full energy with no setup."
    };
    const varied = getDurationPlan("mid", { intro: override });

    const introBefore = base.sectionPlan.find((s) => s.key === "intro")!;
    const introAfter = varied.sectionPlan.find((s) => s.key === "intro")!;

    // Intro fields changed to the override, key/label preserved for the tag contract.
    expect(introAfter.key).toBe("intro");
    expect(introAfter.label).toBe("Intro");
    expect(introAfter.bars).toBe(2);
    expect(introAfter.modifier).toBe(override.modifier);
    expect(introAfter.lyricInstruction).toBe(override.lyricInstruction);
    expect(introBefore.modifier).not.toBe(introAfter.modifier);

    // Every non-intro section is byte-identical to the base plan.
    for (let i = 0; i < base.sectionPlan.length; i += 1) {
      if (base.sectionPlan[i].key === "intro") continue;
      expect(varied.sectionPlan[i]).toEqual(base.sectionPlan[i]);
    }
    // Non-section fields are carried through.
    expect(varied.templateId).toBe(base.templateId);
    expect(varied.totalPlannedBars).toBe(base.totalPlannedBars);
  });

  it("does not mutate the shared constant when opts are used", () => {
    const originalIntro = { ...getDurationPlan("mid").sectionPlan.find((s) => s.key === "intro")! };
    getDurationPlan("mid", {
      intro: {
        bars: 99,
        lineFloor: 5,
        lineTarget: "mutated",
        modifier: "mutated modifier",
        lyricInstruction: "mutated instruction"
      }
    });
    const afterIntro = getDurationPlan("mid").sectionPlan.find((s) => s.key === "intro")!;
    expect(afterIntro).toEqual(originalIntro);
    expect(afterIntro.bars).not.toBe(99);
  });
});
