import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { readResolvedConfig } from "../src/services/runtimeConfig";

async function seedActiveSong(root: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "r10-observation", "R10 Observation");
  await writeSongBrief(root, "r10-observation", [
    "# Brief",
    "- Mood: guarded",
    "- Tempo: 120 BPM",
    "- Duration: 4 min",
    "- Style notes: low drums",
    "- Lyrics theme: radio silence"
  ].join("\n"));
  await updateSongState(root, "r10-observation", { status: "lyrics" });
  await writeAutopilotRunState(root, {
    runId: "r10-observation",
    currentSongId: "r10-observation",
    stage: "prompt_pack",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString()
  });
}

describe("R10 observation always-on boundary", () => {
  it("collects observations without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-observation-"));
    await seedActiveSong(root);
    const before = await readResolvedConfig(root);

    await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } },
      observationRunner: async () => ({ stdout: "culture keeps moving through quiet wires" })
    });
    const after = await readResolvedConfig(root);

    expect(after.autopilot.dryRun).toBe(before.autopilot.dryRun);
    expect(after.autopilot.dryRun).toBe(true);
    expect(after.distribution.liveGoArmed).toBe(before.distribution.liveGoArmed);
    expect(after.distribution.platforms.x.liveGoArmed).toBe(before.distribution.platforms.x.liveGoArmed);
    expect(after.distribution.platforms.instagram.liveGoArmed).toBe(before.distribution.platforms.instagram.liveGoArmed);
    expect(after.distribution.platforms.tiktok.liveGoArmed).toBe(before.distribution.platforms.tiktok.liveGoArmed);
  });
});
