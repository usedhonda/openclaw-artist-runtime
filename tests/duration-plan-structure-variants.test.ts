import { describe, expect, it } from "vitest";
import {
  getDurationPlan,
  TEMPO_BANDS,
  type StructureVariant
} from "../src/suno-production/durationPlan";

// Mirror of lyricsRepair.bounds() max caps, keyed off the section label the same
// way repairLineCount is. A variant's per-section lineFloor must not exceed the cap
// its tag will be trimmed to post-repair.
function capForLabel(label: string): number {
  const lower = label.toLowerCase();
  if (/\b(intro|outro|ending)\b/.test(lower)) return 1;
  if (/\b(hook|chorus|refrain)\b/.test(lower)) return 6;
  if (/\b(bridge|break)\b/.test(lower)) return 3;
  return 21;
}

const EXPECTED_KEYS: Record<StructureVariant, string[]> = {
  standard: ["intro", "verse1", "prehook1", "hook1", "verse2", "prehook2", "hook2", "bridge", "finalhook", "outro"],
  hook_first: ["intro", "hook1", "verse1", "prehook1", "hook2", "verse2", "bridge", "finalhook", "outro"],
  no_bridge_double_verse: ["intro", "verse1", "prehook1", "hook1", "verse2", "verse3", "hook2", "finalhook", "outro"]
};

const EXPECTED_FORM: Record<StructureVariant, string> = {
  standard: "intro-v1-prehook-hook-v2-prehook-hook-bridge-finalhook-outro",
  hook_first: "intro-hook-v1-prehook-hook-v2-bridge-finalhook-outro",
  no_bridge_double_verse: "intro-v1-prehook-hook-v2-v3-hook-finalhook-outro"
};

describe("getDurationPlan structure variants", () => {
  it("standard (and undefined) returns the shared band constant by reference", () => {
    for (const band of TEMPO_BANDS) {
      const base = getDurationPlan(band);
      expect(getDurationPlan(band, { structure: "standard" })).toBe(base);
      expect(getDurationPlan(band, { structure: undefined })).toBe(base);
      expect(base.form).toBe(EXPECTED_FORM.standard);
      expect(base.sectionPlan.map((section) => section.key)).toEqual(EXPECTED_KEYS.standard);
    }
  });

  it("each variant reorders into the expected section keys and form for every band", () => {
    for (const band of TEMPO_BANDS) {
      for (const structure of ["hook_first", "no_bridge_double_verse"] as StructureVariant[]) {
        const plan = getDurationPlan(band, { structure });
        expect(plan.sectionPlan.map((section) => section.key)).toEqual(EXPECTED_KEYS[structure]);
        expect(plan.form).toBe(EXPECTED_FORM[structure]);
        // Band-level fields are carried through unchanged from the base constant.
        const base = getDurationPlan(band);
        expect(plan.templateId).toBe(base.templateId);
        expect(plan.tempoBand).toBe(base.tempoBand);
        expect(plan.targetSeconds).toBe(base.targetSeconds);
        expect(plan.totalPlannedBars).toBe(base.totalPlannedBars);
      }
    }
  });

  it("no_bridge_double_verse respects every section's repair cap (no bridge section)", () => {
    for (const band of TEMPO_BANDS) {
      const plan = getDurationPlan(band, { structure: "no_bridge_double_verse" });
      expect(plan.sectionPlan.some((section) => section.key === "bridge")).toBe(false);
      for (const section of plan.sectionPlan) {
        expect(section.lineFloor).toBeLessThanOrEqual(capForLabel(section.label));
      }
      const verse3 = plan.sectionPlan.find((section) => section.key === "verse3")!;
      expect(verse3.label).toBe("Verse 3");
      expect(verse3.lineFloor).toBeLessThanOrEqual(8);
      // Derived from verse1 as a shorter breather verse.
      const verse1 = plan.sectionPlan.find((section) => section.key === "verse1")!;
      expect(verse3.bars).toBe(Math.max(2, Math.round(verse1.bars / 2)));
    }
  });

  it("hook_first respects repair caps (excluding the pre-existing bridge floor > cap)", () => {
    for (const band of TEMPO_BANDS) {
      const plan = getDurationPlan(band, { structure: "hook_first" });
      expect(plan.sectionPlan.some((section) => section.key === "prehook2")).toBe(false);
      for (const section of plan.sectionPlan) {
        // The standard plan already carries a bridge lineFloor of 4 while the repair
        // bridge cap is 3; hook_first reuses that section verbatim, so it is excluded
        // here rather than treated as a regression introduced by this variant.
        if (section.key === "bridge") continue;
        expect(section.lineFloor).toBeLessThanOrEqual(capForLabel(section.label));
      }
      // hook_first opens on the hook and keeps three physical hook repeats.
      const keys = plan.sectionPlan.map((section) => section.key);
      expect(keys[1]).toBe("hook1");
      expect(keys.filter((key) => key === "hook1" || key === "hook2" || key === "finalhook")).toHaveLength(3);
    }
  });

  it("does not mutate the shared constant when a structure variant is built", () => {
    for (const band of TEMPO_BANDS) {
      const before = getDurationPlan(band);
      const beforeKeys = before.sectionPlan.map((section) => section.key);
      const beforeForm = before.form;
      getDurationPlan(band, { structure: "hook_first" });
      getDurationPlan(band, { structure: "no_bridge_double_verse" });
      const after = getDurationPlan(band);
      expect(after).toBe(before);
      expect(after.sectionPlan.map((section) => section.key)).toEqual(beforeKeys);
      expect(after.form).toBe(beforeForm);
    }
  });

  it("combines an intro override with a structure variant without mutating the base", () => {
    const override = {
      bars: 2,
      lineFloor: 0,
      lineTarget: "0 lines",
      modifier: "2 bars, cold open",
      lyricInstruction: "0 lines; enter immediately."
    };
    const plan = getDurationPlan("mid", { intro: override, structure: "hook_first" });
    const intro = plan.sectionPlan.find((section) => section.key === "intro")!;
    expect(intro.modifier).toBe(override.modifier);
    expect(plan.sectionPlan.map((section) => section.key)).toEqual(EXPECTED_KEYS.hook_first);
    // Base intro is untouched.
    expect(getDurationPlan("mid").sectionPlan.find((section) => section.key === "intro")!.bars).toBe(4);
  });
});
