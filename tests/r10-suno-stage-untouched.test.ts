import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { readResolvedConfig } from "../src/services/runtimeConfig";

describe("R10 Suno stage boundary", () => {
  it("runs Suno generation without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-suno-stage-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "r10-suno", "R10 Suno");
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "r10-suno",
      songTitle: "R10 Suno",
      artistReason: "test",
      lyricsText: "dead neon",
      knowledgePackVersion: "test"
    });
    await updateSongState(root, "r10-suno", { status: "suno_prompt_pack" });
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
