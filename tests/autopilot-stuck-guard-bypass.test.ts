import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";

async function seedSunoSong(root: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "stuck-song", "Stuck Song");
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId: "stuck-song",
    songTitle: "Stuck Song",
    artistReason: "test",
    lyricsText: "dead neon",
    knowledgePackVersion: "test"
  });
  await updateSongState(root, "stuck-song", { status: "suno_prompt_pack" });
}

describe("autopilot stuck guard bypass", () => {
  it("reattempts the same stage when blockedReason is unresolved", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-stuck-bypass-"));
    await seedSunoSong(root);
    await writeAutopilotRunState(root, {
      runId: "same-run",
      currentSongId: "stuck-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 7,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      lastSuccessfulStage: "suno_generation",
      blockedReason: "previous Suno outage"
    });

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, music: { suno: { driver: "playwright" as const } } }
    });

    expect(state.cycleCount).toBe(8);
    expect(state.stage).toBe("suno_generation");
    expect(state.blockedReason).not.toBe("previous Suno outage");
  });

  it("keeps the same-stage guard when no block or error is unresolved", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-stuck-short-"));
    await seedSunoSong(root);
    await writeAutopilotRunState(root, {
      runId: "same-run",
      currentSongId: "stuck-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 7,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      lastSuccessfulStage: "suno_generation"
    });

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, music: { suno: { driver: "playwright" as const } } }
    });

    expect(state.cycleCount).toBe(7);
    expect(state.stage).toBe("suno_generation");
    expect(state.blockedReason).toBeUndefined();
    expect(state.lastSuccessfulStage).toBe("suno_generation");
  });
});
