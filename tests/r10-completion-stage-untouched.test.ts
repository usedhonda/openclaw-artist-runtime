import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { readResolvedConfig } from "../src/services/runtimeConfig";

describe("R10 completion stage boundary", () => {
  it("completes the autopilot cycle without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-completion-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "r10-complete", "R10 Complete");
    await updateSongState(root, "r10-complete", { status: "published", reason: "dry-run publish simulated" });
    await writeAutopilotRunState(root, {
      runId: "r10-complete",
      currentSongId: "r10-complete",
      stage: "publishing",
      paused: false,
      retryCount: 1,
      cycleCount: 1,
      blockedReason: "dry-run publish simulated",
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastSuccessfulStage: "publishing"
    });
    const before = await readResolvedConfig(root);

    await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
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
