import { describe, expect, it } from "vitest";
import {
  INTRO_ARCHETYPE_IDS,
  buildIntroVariantById,
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

  it("uses one artist-led opening contract instead of rotating stock archetypes", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      seen.add(resolveIntroVariant(`intro:song-${i}\nbrief ${i}`).id);
    }
    expect([...seen].sort()).toEqual([...INTRO_ARCHETYPE_IDS].sort());
    expect(seen).toEqual(new Set(["artist_led"]));
  });

  it("keeps legacy persisted archetypes readable", () => {
    expect(buildIntroVariantById("cold_open", "legacy")).toMatchObject({ id: "cold_open" });
    expect(buildIntroVariantById("artist_led", "current")).toMatchObject({
      id: "artist_led",
      entryMode: "artist_led"
    });
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
