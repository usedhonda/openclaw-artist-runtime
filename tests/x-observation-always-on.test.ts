import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { readTodayObservations } from "../src/services/xObservationCollector";

async function seedActiveSong(root: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "active-song", "Active Song");
  await writeSongBrief(root, "active-song", [
    "# Brief",
    "- Mood: alert",
    "- Tempo: 124 BPM",
    "- Duration: 4 min",
    "- Style notes: dusted bass",
    "- Lyrics theme: society keeps blinking"
  ].join("\n"));
  await updateSongState(root, "active-song", { status: "lyrics" });
  await writeAutopilotRunState(root, {
    runId: "active-song",
    currentSongId: "active-song",
    stage: "prompt_pack",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString()
  });
}

describe("autopilot always-on X observation", () => {
  it("collects observations even while a song is already in production", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-x-observation-always-on-"));
    await seedActiveSong(root);
    const runner = vi.fn(async () => ({ stdout: "@neon_watcher society keeps blinking under neon ash https://x.com/neon_watcher/status/1111111111111111111 2026-05-09T08:00:00.000Z" }));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } },
      observationRunner: runner
    });

    const observations = await readTodayObservations(root);
    expect(state.currentSongId).toBe("active-song");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(observations).toContain("society keeps blinking");
    expect(existsSync(join(root, "observations"))).toBe(true);
  });
});
