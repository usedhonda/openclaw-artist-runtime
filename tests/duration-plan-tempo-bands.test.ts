import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TEMPO_BANDS,
  getDurationPlan,
  getDurationPlanByTemplateId,
  minimumBareLyricsChars,
  minimumBareLyricsLines,
  resolveTempoBand,
  type TempoBand
} from "../src/suno-production/durationPlan";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";
import { createSongIdea } from "../src/services/songIdeation";

// repairLineCount caps the mock/AI draft per section, so the achievable line
// ceiling for the shared 10-section form is verse(21)+verse(21)+prehook(6)+
// hook(6)+prehook(6)+hook(6)+bridge(3)+finalhook(6)+intro(1)+outro(1) = 77.
const REPAIR_LINE_CEILING = 77;

describe("duration plan tempo bands", () => {
  it("exposes four bands with distinct increasing tempos", () => {
    expect([...TEMPO_BANDS]).toEqual(["slow", "mid", "up", "dopagaki"]);
    const targets = TEMPO_BANDS.map((band) => getDurationPlan(band).bpm.target);
    expect(targets).toEqual([...targets].sort((a, b) => a - b));
    expect(new Set(targets).size).toBe(4);
  });

  it("keeps the mid template as the backward-compatible default (108 BPM, 80 bars, 1200/52 floor)", () => {
    const mid = getDurationPlan();
    expect(mid).toBe(getDurationPlan("mid"));
    expect(mid.templateId).toBe("default_nu_jazz_rap_full_v1");
    expect(mid.bpm.target).toBe(108);
    expect(mid.totalPlannedBars).toBe(80);
    expect(minimumBareLyricsChars(mid)).toBe(1200);
    expect(minimumBareLyricsLines(mid)).toBe(52);
  });

  it("keeps every template internally coherent and achievable under repair caps", () => {
    for (const band of TEMPO_BANDS) {
      const plan = getDurationPlan(band);
      const barSum = plan.sectionPlan.reduce((sum, section) => sum + section.bars, 0);
      expect(barSum).toBe(plan.totalPlannedBars);
      expect(minimumBareLyricsChars(plan)).toBe(Math.round(plan.totalPlannedBars * 15));
      const lineFloor = plan.sectionPlan.reduce((sum, section) => sum + section.lineFloor, 0);
      expect(minimumBareLyricsLines(plan)).toBe(lineFloor);
      // The line floor must stay reachable given the per-section repair caps.
      expect(lineFloor).toBeLessThanOrEqual(REPAIR_LINE_CEILING);
      // The 195s target and hook-repeat contract stay band-invariant.
      expect(plan.targetSeconds).toBe(195);
      expect(plan.chorusPolicy.physicalRepeats).toBe(3);
      expect(plan.sectionPlan).toHaveLength(10);
    }
  });

  it("scales tempo, bars and density up as the band gets faster", () => {
    const slow = getDurationPlan("slow");
    const mid = getDurationPlan("mid");
    const up = getDurationPlan("up");
    const dopagaki = getDurationPlan("dopagaki");
    expect(slow.totalPlannedBars).toBeLessThan(mid.totalPlannedBars);
    expect(mid.totalPlannedBars).toBeLessThan(up.totalPlannedBars);
    expect(up.totalPlannedBars).toBeLessThan(dopagaki.totalPlannedBars);
    expect(minimumBareLyricsLines(slow)).toBeLessThan(minimumBareLyricsLines(mid));
    expect(minimumBareLyricsLines(up)).toBeGreaterThan(minimumBareLyricsLines(mid));
    expect(minimumBareLyricsLines(dopagaki)).toBeGreaterThan(minimumBareLyricsLines(up));
  });

  it("only the dopagaki band permits double-time vocal", () => {
    expect(getDurationPlan("slow").bpm.noDoubleTimeVocal).toBe(true);
    expect(getDurationPlan("mid").bpm.noDoubleTimeVocal).toBe(true);
    expect(getDurationPlan("up").bpm.noDoubleTimeVocal).toBe(true);
    expect(getDurationPlan("dopagaki").bpm.noDoubleTimeVocal).toBe(false);
  });

  it("resolves the tempo band from a brief marker and falls back when absent", () => {
    expect(resolveTempoBand("## Direction\n- Tempo band: dopagaki\n")).toBe("dopagaki");
    expect(resolveTempoBand("- Tempo band: slow")).toBe("slow");
    expect(resolveTempoBand("- Tempo band: Up")).toBe("up");
    expect(resolveTempoBand("no band here")).toBeUndefined();
    expect(resolveTempoBand("- Tempo band: nonsense")).toBeUndefined();
    expect(resolveTempoBand(undefined)).toBeUndefined();
  });

  it("resolves a plan by template id and falls back to mid for unknown ids", () => {
    for (const band of TEMPO_BANDS) {
      const plan = getDurationPlan(band);
      expect(getDurationPlanByTemplateId(plan.templateId)).toBe(plan);
    }
    expect(getDurationPlanByTemplateId("unknown_template")).toBe(getDurationPlan("mid"));
    expect(getDurationPlanByTemplateId(undefined)).toBe(getDurationPlan("mid"));
  });
});

describe("tempo band selection wiring", () => {
  async function workspace(): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-tempo-band-"));
    await mkdir(join(root, "artist"), { recursive: true });
    await writeFile(join(root, "ARTIST.md"), "used::honda\n## Current Artist Core\n- civic noise\n", "utf8");
    await writeFile(join(root, "artist", "CURRENT_STATE.md"), "## Current Obsessions\n- civic rooms replaced by chats\n", "utf8");
    return root;
  }

  it("writes an explicit tempo band into the generated brief", async () => {
    const root = await workspace();
    const idea = await createSongIdea({ workspaceRoot: root, theme: "midnight signage", tempoBand: "dopagaki" });
    const brief = await readFile(idea.briefPath, "utf8");
    expect(resolveTempoBand(brief)).toBe("dopagaki");
  });

  it("always records a resolvable tempo band even without an explicit choice", async () => {
    const root = await workspace();
    const idea = await createSongIdea({ workspaceRoot: root, theme: "quiet redevelopment" });
    const brief = await readFile(idea.briefPath, "utf8");
    const band = resolveTempoBand(brief);
    expect(band && (TEMPO_BANDS as readonly TempoBand[]).includes(band)).toBe(true);
  });

  it("bakes the selected band's template id and BPM into the prompt pack payload YAML", () => {
    const base = {
      songId: "song-tempo",
      songTitle: "Dopagaki Test Cut",
      artistReason: "fast civic anger over redevelopment signage",
      lyricsText: "[Verse 1 - fast]\nしぶやのよるにさびたひかり\n[Hook - chant]\nにげたこえをおわない\n",
      artistSnapshot: "used::honda\n- gender: male\n",
      currentStateSnapshot: "## Current Obsessions\n- signage\n"
    };
    const dopagaki = createSunoPromptPack({ ...base, tempoBand: "dopagaki" });
    const dopagakiYaml = String((dopagaki.payload as { payloadYaml?: string }).payloadYaml ?? "");
    expect(dopagakiYaml).toContain("template: dopagaki_fast_rap_v1");
    expect(dopagakiYaml).toContain("tempo: 148");

    const mid = createSunoPromptPack({ ...base, songId: "song-mid" });
    const midYaml = String((mid.payload as { payloadYaml?: string }).payloadYaml ?? "");
    expect(midYaml).toContain("template: default_nu_jazz_rap_full_v1");
    expect(midYaml).toContain("tempo: 108");
  });
});
