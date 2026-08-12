import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import {
  ArtistAutopilotService,
  correctionGuidanceFromDegraded,
  parkSongForOperator,
  writeAutopilotRunState
} from "../src/services/autopilotService";
import { resurfaceDegradedLyrics } from "../src/services/degradedLyricsResurfaceService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import type { AutopilotRunState } from "../src/types";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-park-advance-"));
}

const completeBrief = [
  "# Brief",
  "- Mood: cold",
  "- Tempo: 128 BPM",
  "- Duration: 4 min",
  "- Style notes: thick bass",
  "- Lyrics theme: city ruins"
].join("\n");

function baseRunState(root: string, songId: string): AutopilotRunState {
  return {
    runId: songId,
    currentSongId: songId,
    stage: "prompt_pack",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    lastSuccessfulStage: "planning"
  };
}

describe("prompt-pack corrective regen + skip-and-advance parking", () => {
  it("extracts kanji/number correction guidance and returns undefined for non-content failures", () => {
    const guided = correctionGuidanceFromDegraded(
      "lyrics_generation_degraded: suno_prompt_pack_invalid: suno lyrics registration text still has non-hiragana Japanese: residual_kanji:蜃気楼:line_2; suno lyrics registration text still has non-hiragana Japanese: ascii_number:145:line_5"
    );
    expect(guided).toBeDefined();
    expect(guided!.join("\n")).toContain("蜃気楼(line 2)");
    expect(guided!.join("\n")).toContain("145(line 5)");

    expect(
      correctionGuidanceFromDegraded("lyrics_generation_degraded: styleAndFeel length exceeds hard cap: 931/120")
    ).toBeUndefined();
    expect(
      correctionGuidanceFromDegraded("lyrics_generation_degraded: lyrics_too_long_for_suno_box: lyric body 6000/3000")
    ).toEqual([expect.stringContaining("短く書き直す")]);
    expect(
      correctionGuidanceFromDegraded("lyrics_generation_degraded: lyrics_too_short_for_duration_plan: bare lyric body 1543/1650, lines 65/64")
    ).toEqual([expect.stringContaining("最低1650文字")]);
  });

  it("switches to a blanket all-hiragana rewrite when many tokens remain", () => {
    const tokens = ["数字", "逃", "鳴", "値", "送電", "見下", "札", "灯", "影", "街"];
    const reason = `lyrics_generation_degraded: suno_prompt_pack_invalid: ${tokens
      .map((token, index) => `residual_kanji:${token}:line_${index + 1}`)
      .join("; ")}`;
    const guided = correctionGuidanceFromDegraded(reason);
    expect(guided).toBeDefined();
    expect(guided!).toHaveLength(1);
    // A blanket instruction, not a per-token enumeration.
    expect(guided![0]).toContain("全文をひらがなで書き直す");
    expect(guided![0]).not.toContain("(line 1)");
  });

  it("parks an unrepairable song as a terminal needs-operator state, alerts once, and clears the current song", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-park", "Parked Song");
    await writeAutopilotRunState(root, baseRunState(root, "song-park"));

    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const existing = await ensureSongState(root, "song-park", "Parked Song").then(() => baseRunState(root, "song-park"));
    const next = await parkSongForOperator(
      root,
      existing,
      baseRunState(root, "song-park"),
      "song-park",
      "lyrics_generation_degraded: suno_prompt_pack_invalid: residual_kanji:蜃気楼:line_2"
    );

    unsubscribe();

    expect(next.stage).toBe("planning");
    expect(next.currentSongId).toBeUndefined();
    expect(next.paused).toBeFalsy();

    const song = await readSongState(root, "song-park");
    expect(song.status).toBe("failed");
    expect(song.degradedLyrics).toBe(true);
    expect(song.lastReason ?? "").toContain("parked_needs_operator");

    const parkedAlerts = events.filter(
      (event) => event.type === "lyrics_generation_degraded" && event.detail === "parked_needs_operator:song-park"
    );
    expect(parkedAlerts).toHaveLength(1);
  });

  it("does not resurface a parked (terminal failed) song, so there is no 20-minute re-send loop", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-park", "Parked Song");
    await updateSongState(root, "song-park", { status: "failed", degradedLyrics: true, reason: "parked_needs_operator: x" });
    await writeAutopilotRunState(root, { ...baseRunState(root, "song-park"), stage: "planning", currentSongId: undefined });

    const result = await resurfaceDegradedLyrics(root, { songId: "song-park", now: 5000 });
    expect(result.resurfaced).toBe(false);
  });

  it("runs one corrective re-draft that fixes a degraded pack instead of pausing the whole autopilot", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-fixable", "Fixable Song");
    await writeSongBrief(root, "song-fixable", completeBrief);
    // Pre-existing lyrics with an unknown kanji that survives normalization, so the
    // first prompt-pack build fails validation. Status "lyrics" makes ensureLyrics
    // reuse this text on the first attempt; the corrective re-draft then forces a
    // clean regeneration.
    await mkdir(join(root, "songs", "song-fixable", "lyrics"), { recursive: true });
    await writeFile(join(root, "songs", "song-fixable", "lyrics", "lyrics.v1.md"), "[Verse 1]\n蜃気楼のまち\n", "utf8");
    await updateSongState(root, "song-fixable", { status: "lyrics", lyricsVersion: 1 });
    await writeAutopilotRunState(root, baseRunState(root, "song-fixable"));

    const config = {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true },
      telegram: { enabled: false }
    };
    const state = await new ArtistAutopilotService().runCycle({ workspaceRoot: root, config });

    expect(state.stage).toBe("suno_generation");
    expect(state.paused).toBeFalsy();
    const song = await readSongState(root, "song-fixable");
    expect(song.status).not.toBe("failed");
    expect(song.degradedLyrics).toBe(false);
  }, 30_000);
});
