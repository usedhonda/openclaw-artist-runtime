import { describe, expect, it } from "vitest";
import { buildYaml, computeBudgetLevel } from "../src/suno-production/buildYaml";

function input(lyrics: string) {
  return {
    title: "Budget Gate",
    lyrics,
    meta: {
      tempo: 128,
      key: "F minor",
      signature: "4/4",
      form: "intro-verse-hook-verse-bridge-hook-outro",
      vibe: "cold pressure",
      language: "ja"
    },
    vocals: {
      parts: [
        { id: "lead", tone: "dry close vocal" },
        { id: "double", tone: "narrow hook lift" }
      ],
      rules: ["keep consonants clear", "avoid theatrical belting", "preserve rhythmic phrasing"]
    },
    production_notes: ["bass forward", "restrained drums", "no novelty pivots"],
    notes: ["original only", "metadata not singable", "no source-name imitation"],
    cues: ["Verse: sparse", "Hook: wider", "Outro: hard stop"]
  };
}

describe("Suno YAML dynamic budget", () => {
  it("classifies lyrics length into four budget levels", () => {
    expect(computeBudgetLevel("あ".repeat(4300), 4800)).toBe("minimal");
    expect(computeBudgetLevel("あ".repeat(3800), 4800)).toBe("normal");
    expect(computeBudgetLevel("あ".repeat(3000), 4800)).toBe("expanded");
    expect(computeBudgetLevel("あ".repeat(2200), 4800)).toBe("max");
  });

  it("uses minimal YAML when lyrics leave almost no metadata budget", () => {
    const yaml = buildYaml({ ...input("あ".repeat(4300)), lyricsBoxLimit: 4800 });
    expect(yaml.length).toBeLessThanOrEqual(4800);
    expect(yaml).not.toContain("vocals:");
    expect(yaml).toContain("duration_plan:");
    expect(yaml).toContain("LYRICS END");
  });

  it("keeps legacy string vocals and normal metadata path working", () => {
    const yaml = buildYaml({
      title: "Legacy",
      lyrics: "あ".repeat(4000),
      meta: { vibe: "legacy dusk" },
      vocals: "dry vocal",
      productionNotes: "restrained mix",
      notes: "original only"
    });
    expect(yaml).toContain("vocals:");
    expect(yaml).toContain("- dry vocal");
    expect(yaml).toContain("production_notes:");
    expect(yaml).toContain("- restrained mix");
  });

  it("uses expanded typed fields and max cues when budget allows", () => {
    const expanded = buildYaml({ ...input("あ".repeat(3000)), lyricsBoxLimit: 4800 });
    expect(expanded).toContain("sections:");
    expect(expanded).toContain("- keep consonants clear");
    expect(expanded).toContain("- avoid theatrical belting");
    expect(expanded).toContain("cues:");

    const max = buildYaml({ ...input("あ".repeat(2200)), lyricsBoxLimit: 4800 });
    expect(max).toContain("parts:");
    expect(max).toContain("cues:");
    expect(max).toContain("- Hook: wider");
  });

  it("throws instead of slicing lyrics when even minimal YAML overflows", () => {
    expect(() => buildYaml({ ...input("あ".repeat(4780)), lyricsBoxLimit: 4800 })).toThrow("YAML overflow");
  });

  it("keeps lyrics intact and shrinks META to fit an explicit Suno box limit", () => {
    const lyrics = "あ".repeat(760);
    const yaml = buildYaml({ ...input(lyrics), lyricsBoxLimit: 1250 });
    expect(yaml.length).toBeLessThanOrEqual(1250);
    expect(yaml).toContain(lyrics);
    expect(yaml).toContain("# META (hints; do not sing)");
    expect(yaml).not.toContain("vocals:");
  });

  it("fails closed when lyrics plus minimal META cannot fit an explicit Suno box limit", () => {
    expect(() => buildYaml({ ...input("あ".repeat(1120)), lyricsBoxLimit: 1250 })).toThrow("YAML overflow");
  });
});
