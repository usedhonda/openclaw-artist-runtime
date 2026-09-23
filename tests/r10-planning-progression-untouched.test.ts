import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSongState, writeSongBrief } from "../src/services/artistState";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { readResolvedConfig } from "../src/services/runtimeConfig";

describe("R10 planning progression boundary", () => {
  it("progresses planning without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-planning-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "planning-r10", "Planning R10");
    await writeSongBrief(root, "planning-r10", "# Brief\n\n- Mood: cold");
    await writeAutopilotRunState(root, {
      runId: "planning-r10",
      currentSongId: "planning-r10",
      stage: "planning",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      lastRunAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSuccessfulStage: "planning"
    });
    const before = await readResolvedConfig(root);

    await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: true, dryRun: true }, telegram: { enabled: false } }
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
