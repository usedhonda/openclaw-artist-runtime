import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { importSunoResults } from "../src/services/sunoRuns";

const { connectorStatus, connectorImportResults, connectorCreate } = vi.hoisted(() => ({
  connectorStatus: vi.fn(),
  connectorImportResults: vi.fn(),
  connectorCreate: vi.fn()
}));

vi.mock("../src/connectors/suno/browserWorkerConnector", () => ({
  BrowserWorkerSunoConnector: vi.fn().mockImplementation(() => ({
    status: connectorStatus,
    importResults: connectorImportResults,
    create: connectorCreate
  }))
}));

describe("autopilot Suno import stage", () => {
  it("imports pending worker results instead of starting another create", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-autopilot-import-stage-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "import-song", "Import Song");
    await updateSongState(root, "import-song", { status: "suno_running" });
    await writeAutopilotRunState(root, {
      runId: "import-song",
      currentSongId: "import-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastSuccessfulStage: "suno_generation",
      blockedReason: "waiting for Suno result import"
    });
    await importSunoResults({
      workspaceRoot: root,
      songId: "import-song",
      runId: "run-live",
      urls: ["https://suno.com/song/take-a", "https://suno.com/song/take-b"]
    });
    await updateSongState(root, "import-song", { status: "suno_running" });
    connectorStatus.mockResolvedValue({
      state: "generating",
      connected: true,
      currentRunId: "run-live"
    });
    connectorImportResults.mockResolvedValue({
      accepted: true,
      runId: "run-live",
      urls: ["https://suno.com/song/take-a", "https://suno.com/song/take-b"],
      paths: ["runtime/suno/run-live/take-a.mp3"],
      reason: "mock import complete"
    });

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, music: { suno: { driver: "playwright" as const } } }
    });

    expect(connectorImportResults).toHaveBeenCalledWith({
      runId: "run-live",
      urls: ["https://suno.com/song/take-a", "https://suno.com/song/take-b"]
    });
    expect(connectorCreate).not.toHaveBeenCalled();
    expect(state.stage).toBe("take_selection");
    expect(await readSongState(root, "import-song")).toMatchObject({ status: "takes_imported" });
  });
});
