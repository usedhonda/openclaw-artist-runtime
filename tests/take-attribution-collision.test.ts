import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

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
      createdAt: "2026-05-24T00:00:00.000Z",
      mode: "background_browser_worker",
      authorityDecision: { allowed: true, reason: "test accepted", policyDecision: "allow" },
      status: "accepted",
      dryRun: false,
      urls
    })}\n`,
    "utf8"
  );
}

describe("take attribution collision guard", () => {
  afterEach(() => {
    connectorStatus.mockReset();
    connectorImportResults.mockReset();
    connectorCreate.mockReset();
    getRuntimeEventBus().clearForTest();
  });

  it("blocks import and pauses autopilot when a Suno take URL already belongs to another song", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-collision-"));
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "current-song", "Current Song");
    await ensureSongState(root, "older-song", "Older Song");
    await updateSongState(root, "current-song", { status: "suno_running" });
    await updateSongState(root, "older-song", {
      status: "take_selected",
      appendPublicLinks: ["https://suno.com/song/duplicate-take"]
    });
    await writeAcceptedRun(root, "current-song", "run-current", ["https://suno.com/song/duplicate-take"]);
    await writeAutopilotRunState(root, {
      runId: "current-song",
      currentSongId: "current-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastSuccessfulStage: "suno_generation",
      blockedReason: "waiting for Suno result import"
    });
    connectorStatus.mockResolvedValue({
      state: "generating",
      connected: true,
      currentRunId: "run-current"
    });
    connectorImportResults.mockResolvedValue({
      accepted: true,
      runId: "run-current",
      urls: ["https://suno.com/song/duplicate-take"],
      paths: ["runtime/suno/run-current/duplicate-take.mp3"],
      reason: "mock import complete"
    });

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: false }, music: { suno: { driver: "playwright" as const } } }
    });
    expect(connectorImportResults).toHaveBeenCalledTimes(1);
    expect(connectorCreate).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      paused: true,
      stage: "paused",
      blockedReason: "take_attribution_collision_blocked",
      lastError: "take_attribution_collision_blocked"
    });
    expect(await readSongState(root, "current-song")).toMatchObject({ status: "suno_running" });
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      source: "take_attribution",
      reason: "take_attribution_collision_blocked",
      songId: "current-song"
    }));
    const audit = await readFile(join(root, "runtime", "take-attribution-audit.jsonl"), "utf8");
    expect(audit).toContain("take_attribution_collision_blocked");
    expect(audit).toContain("older-song");
    unsubscribe();
  });
});
