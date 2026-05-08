import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState.js";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService.js";
import { readLatestSunoRun } from "../src/services/sunoRuns.js";

describe("autopilot Suno mock bypass", () => {
  it.each([true, false])("imports mock takes without requiring a connected browser worker when driver is mock and dryRun=%s", async (dryRun) => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-mock-bypass-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "mock-song", "Mock Song");
    await updateSongState(root, "mock-song", { status: "suno_prompt_pack" });
    await writeAutopilotRunState(root, {
      runId: "mock-song-run",
      currentSongId: "mock-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 1,
      cycleCount: 0,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastSuccessfulStage: "suno_generation",
      blockedReason: "suno_generate_retry:suno_worker_not_connected",
      lastError: "suno_worker_not_connected"
    });

    const service = new ArtistAutopilotService();
    const config = {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun },
      music: { suno: { driver: "mock" as const, connectionMode: "background_browser_worker" as const } },
      telegram: { enabled: false }
    };

    const imported = await service.runCycle({ workspaceRoot: root, config });
    expect(imported).toMatchObject({ stage: "take_selection", blockedReason: undefined, lastError: undefined, retryCount: 0 });
    expect(await readSongState(root, "mock-song")).toMatchObject({ status: "takes_imported" });
    expect((await readLatestSunoRun(root, "mock-song"))?.urls).toEqual([
      "mock://take/mock-song/mock-song-run-mock/take-1",
      "mock://take/mock-song/mock-song-run-mock/take-2"
    ]);

    const selected = await service.runCycle({ workspaceRoot: root, config });
    expect(selected.stage).toBe("take_selection");
    expect(await readSongState(root, "mock-song")).toMatchObject({ status: "take_selected", selectedTakeId: "take-1" });
  });
});
