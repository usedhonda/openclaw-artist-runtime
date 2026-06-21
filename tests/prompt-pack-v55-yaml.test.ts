import { describe, expect, it } from "vitest";
import { buildYaml } from "../src/suno-production/buildYaml";

const lyrics = [
  "[Intro - muted street image]",
  "駅前の時計だけが少し遅れる",
  "",
  "[Verse 1 - tight civic flow]",
  "誰も見ない窓にだけ信号が残る",
  "既読の街で責任だけが遅れる",
  "低いベースが名前を削っていく",
  "朝の手前でまだ息を数える"
].join("\n");

describe("Suno V5.5 YAML builder", () => {
  it("wraps metadata, vocals, production notes, notes, and lyrics delimiters", () => {
    const yaml = buildYaml({
      title: "Civic Echo",
      lyrics,
      meta: {
        tempo: 132,
        key: "D minor",
        signature: "4/4",
        form: "intro-verse-hook-verse-bridge-verse-hook-outro",
        vibe: "civic dread",
        language: "ja"
      },
      vocals: {
        parts: [{ id: "lead", tone: "dry close male vocal" }],
        rules: ["quiet doubles in hook", "clear consonants"]
      },
      production_notes: ["bass forward, restrained drums", "leave space for lyrics"],
      notes: ["no source-name imitation", "lyrics body only inside delimiters"],
      cues: ["Hook: widen without crowd noise"]
    });

    expect(yaml.length).toBeLessThanOrEqual(4500);
    expect(yaml).toContain("# META");
    expect(yaml).toContain("version: v5.5");
    expect(yaml).toContain("vocals:");
    expect(yaml).toContain("parts:");
    expect(yaml).toContain("rules:");
    expect(yaml).toContain("production_notes:");
    expect(yaml).toContain("notes:");
    expect(yaml).toContain("cues:");
    expect(yaml).toContain("LYRICS START");
    expect(yaml).toContain("[Verse 1 - tight civic flow]");
    expect(yaml).toContain("LYRICS END");
  });

  it("throws on overflow instead of destructively truncating lyrics", () => {
    expect(() => buildYaml({
      title: "Long Signal",
      lyrics: "長".repeat(4780),
      meta: { vibe: "long civic dread" }
    })).toThrow("YAML overflow");
  });
});
