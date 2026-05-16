import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
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

async function writeAcceptedRun(root: string, songId: string, runId: string, urls: string[]): Promise<void> {
  const runsPath = join(root, "songs", songId, "suno", "runs.jsonl");
  await mkdir(join(root, "songs", songId, "suno"), { recursive: true });
  await writeFile(
    runsPath,
    `${JSON.stringify({
      runId,
      songId,
      createdAt: "2026-05-15T00:00:00.000Z",
      mode: "background_browser_worker",
      authorityDecision: { allowed: true, reason: "test accepted", policyDecision: "allow" },
      status: "accepted",
      dryRun: false,
      urls
    })}\n`,
    "utf8"
  );
}

describe("autopilot Suno import stage", () => {
  afterEach(() => {
    connectorStatus.mockReset();
    connectorImportResults.mockReset();
    connectorCreate.mockReset();
    getRuntimeEventBus().clearForTest();
  });

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

  it("does not start a second create after restart when a stale import error remains", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-autopilot-import-restart-"));
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "restart-song", "Restart Song");
    await updateSongState(root, "restart-song", { status: "suno_running" });
    await writeAcceptedRun(root, "restart-song", "run-accepted", [
      "https://suno.com/song/restart-a",
      "https://suno.com/song/restart-b"
    ]);
    await writeAutopilotRunState(root, {
      runId: "restart-song",
      currentSongId: "restart-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 1,
      cycleCount: 4,
      updatedAt: "2026-05-15T00:10:00.000Z",
      lastRunAt: "2026-05-15T00:00:00.000Z",
      lastSuccessfulStage: "suno_generation",
      blockedReason: "suno_generate_retry:playwright_import_no_urls",
      lastError: "playwright_import_no_urls"
    });
    connectorStatus.mockResolvedValue({
      state: "connected",
      connected: true
    });
    connectorImportResults.mockResolvedValue({
      accepted: true,
      runId: "run-accepted",
      urls: ["https://suno.com/song/restart-a", "https://suno.com/song/restart-b"],
      paths: ["runtime/suno/run-accepted/restart-a.mp3"],
      reason: "mock import complete"
    });

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: false }, music: { suno: { driver: "playwright" as const } } }
    });

    expect(connectorImportResults).toHaveBeenCalledWith({
      runId: "run-accepted",
      urls: ["https://suno.com/song/restart-a", "https://suno.com/song/restart-b"]
    });
    expect(connectorCreate).not.toHaveBeenCalled();
    expect(state.stage).toBe("take_selection");
    expect(await readSongState(root, "restart-song")).toMatchObject({ status: "takes_imported" });
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      source: "suno_lifecycle_contract",
      songId: "restart-song",
      reason: "suno_lifecycle_contract_pending_import:run-accepted"
    }));
    consoleError.mockRestore();
    unsubscribe();
  });
});
