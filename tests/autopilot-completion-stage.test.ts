import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";

async function seedPublished(root: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "done-song", "Done Song");
  await updateSongState(root, "done-song", { status: "published", selectedTakeId: "take-1", appendPublicLinks: ["https://suno.example/take-1"] });
  await writeAutopilotRunState(root, {
    runId: "done-song",
    currentSongId: "done-song",
    stage: "publishing",
    paused: false,
    retryCount: 2,
    cycleCount: 4,
    blockedReason: "dry-run publish simulated",
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    lastSuccessfulStage: "publishing"
  });
}

describe("autopilot completion stage", () => {
  it("syncs a completed song back into SONGBOOK and resets retries", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-completion-stage-"));
    await seedPublished(root);

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
    });
    const songbook = await readFile(join(root, "artist", "SONGBOOK.md"), "utf8");

    expect(state).toMatchObject({ stage: "completed", lastSuccessfulStage: "completed", retryCount: 0 });
    expect(await readSongState(root, "done-song")).toMatchObject({ status: "published", selectedTakeId: "take-1" });
    expect(songbook).toContain("| done-song | Done Song | published |");
    expect(songbook).toContain("https://suno.example/take-1");
  }, 30_000);

  it("pauses instead of failing closed when completion sync cannot write SONGBOOK", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-completion-fallback-"));
    await seedPublished(root);
    rmSync(join(root, "artist"), { recursive: true, force: true });
    writeFileSync(join(root, "artist"), "not a directory");

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
    });

    expect(state.stage).toBe("paused");
    expect(state.pausedReason).toBe("song_completion_failed");
    expect(state.retryCount).toBe(3);
    expect(state.blockedReason).toContain("song_completion_failed");
  });
});
