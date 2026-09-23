import { describe, expect, it } from "vitest";
import { validateSunoPromptPack } from "../src/validators/promptPackValidator";

const BASE_PACK = {
  songId: "song-structure",
  songTitle: "Structure Gate",
  style: "nu-jazz rap, dry civic pulse, BPM 126, mid-range male rap vocal",
  exclude: "generic reverb",
  yamlLyrics: "gender: male",
  artistSnapshotHash: "a",
  currentStateHash: "b",
  payloadHash: "c",
  knowledgePackHash: "d"
};

function payloadYamlFor(labels: string[]): string {
  const body = labels.map((label) => `[${label}]\nline text`).join("\n");
  return [
    "meta:",
    "  template: up_tempo_rap_v1",
    "=== LYRICS START (do not sing tags) ===",
    body,
    "=== LYRICS END ==="
  ].join("\n");
}

describe("validateSunoPromptPack duration_plan structure awareness", () => {
  it("standard structure (default arg) keeps today's byte-identical prehook expectation of 2", () => {
    // Only Pre-Hook 1 present out of the standard plan's two prehooks.
    const labels = ["Intro", "Verse 1", "Pre-Hook", "Hook", "Verse 2", "Hook 2", "Bridge", "Final Hook", "Outro"];
    const validation = validateSunoPromptPack({
      ...BASE_PACK,
      payload: { payloadYaml: payloadYamlFor(labels) }
    });

    expect(validation.warnings).toContain("duration_plan_prehook_count_below_plan: 1/2");
    expect(validation.warnings).toContain("duration_plan_section_count_below_plan: 9/10");
  });

  it("hook_first structure produces zero duration_plan warnings for correctly-shaped lyrics", () => {
    const labels = ["Intro", "Hook", "Verse 1", "Pre-Hook", "Hook 2", "Verse 2", "Bridge", "Final Hook", "Outro"];
    const validation = validateSunoPromptPack(
      { ...BASE_PACK, payload: { payloadYaml: payloadYamlFor(labels) } },
      "hook_first"
    );

    expect(validation.warnings.filter((warning) => warning.startsWith("duration_plan_"))).toEqual([]);
  });

  it("no_bridge_double_verse structure produces zero duration_plan warnings for correctly-shaped lyrics", () => {
    const labels = ["Intro", "Verse 1", "Pre-Hook", "Hook", "Verse 2", "Verse 3", "Hook 2", "Final Hook", "Outro"];
    const validation = validateSunoPromptPack(
      { ...BASE_PACK, payload: { payloadYaml: payloadYamlFor(labels) } },
      "no_bridge_double_verse"
    );

    expect(validation.warnings.filter((warning) => warning.startsWith("duration_plan_"))).toEqual([]);
  });

  it("still warns a deliberately short hook_first lyric that drops its only prehook", () => {
    const labels = ["Intro", "Hook", "Verse 1", "Hook 2", "Verse 2", "Bridge", "Final Hook", "Outro"];
    const validation = validateSunoPromptPack(
      { ...BASE_PACK, payload: { payloadYaml: payloadYamlFor(labels) } },
      "hook_first"
    );

    expect(validation.warnings).toContain("duration_plan_prehook_count_below_plan: 0/1");
    expect(validation.warnings).toContain("duration_plan_section_count_below_plan: 8/9");
  });
});
