import { describe, expect, it } from "vitest";
import { buildYaml } from "../src/suno-production/buildYaml";

describe("Suno V5.5 lyrics header modifiers", () => {
  it("adds performance modifiers to bare section headers", () => {
    const yaml = buildYaml({
      title: "Header Gate",
      lyrics: ["[Verse 1]", "街の灯りが少し遅れる", "", "[Hook]", "もう待たない"].join("\n"),
      meta: { tempo: 142, vibe: "dry civic pulse" },
      vocals: { parts: [{ id: "lead", gender: "male", tone: "mid-range male rap" }] }
    });

    expect(yaml).toContain("[Verse 1 - 16 bars, spacious rap phrasing, no double-time, mid-range male vocal]");
    expect(yaml).toContain("[Hook - 8 bars, full hook, repeat melody, no double-time, mid-range male vocal]");
  });

  it("leaves existing modifiers untouched", () => {
    const yaml = buildYaml({
      title: "Header Keep",
      lyrics: "[Verse 1 - already tight]\n街の灯りが少し遅れる",
      meta: { tempo: 142, vibe: "dry civic pulse" }
    });

    expect(yaml).toContain("[Verse 1 - already tight]");
  });
});
