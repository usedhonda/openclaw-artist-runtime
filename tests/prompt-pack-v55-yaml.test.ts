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
      vocals: "dry close male vocal, quiet doubles in hook",
      productionNotes: "bass forward, restrained drums",
      notes: "no source-name imitation"
    });

    expect(yaml.length).toBeLessThanOrEqual(4000);
    expect(yaml).toContain("# META");
    expect(yaml).toContain("version: v5.5");
    expect(yaml).toContain("vocals:");
    expect(yaml).toContain("production_notes:");
    expect(yaml).toContain("notes:");
    expect(yaml).toContain("LYRICS START");
    expect(yaml).toContain("[Verse 1 - tight civic flow]");
    expect(yaml).toContain("LYRICS END");
  });

  it("caps oversized YAML at 4000 chars while retaining the end delimiter", () => {
    const yaml = buildYaml({
      title: "Long Signal",
      lyrics: `${lyrics}\n${"長い行\n".repeat(1000)}`,
      meta: { vibe: "long civic dread" }
    });

    expect(yaml.length).toBeLessThanOrEqual(4000);
    expect(yaml.endsWith("LYRICS END")).toBe(true);
  });
});
