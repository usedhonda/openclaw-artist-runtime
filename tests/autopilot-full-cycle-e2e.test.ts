import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ArtistAutopilotService, readAutopilotRunState } from "../src/services/autopilotService";
import { readSongState } from "../src/services/artistState";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { importSunoResults, readLatestSunoRun } from "../src/services/sunoRuns";

describe("autopilot planning to completed e2e", () => {
  beforeEach(() => spawnMock.mockReset());

  it("runs planning through take completion and releases the current song lane", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-full-cycle-e2e-"));
    await ensureArtistWorkspace(root);
    vi.stubGlobal("fetch", vi.fn());
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const service = new ArtistAutopilotService();
    const config = { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, music: { suno: { driver: "playwright" as const } }, distribution: { enabled: true, platforms: { x: { enabled: true } } } };
    const stages: string[] = [];

    stages.push((await service.runCycle({ workspaceRoot: root, config })).stage);
    const songId = (await readAutopilotRunState(root)).currentSongId ?? "song-001";
    stages.push((await service.runCycle({ workspaceRoot: root, config })).stage);
    stages.push((await service.runCycle({ workspaceRoot: root, config })).stage);
    const run = await readLatestSunoRun(root, songId);
    await importSunoResults({ workspaceRoot: root, songId, runId: run?.runId ?? "dry-run", urls: ["https://suno.example/good-bass-cold-hook"] });
    stages.push((await service.runCycle({ workspaceRoot: root, config })).stage);
    unsubscribe();

    const song = await readSongState(root, songId);
    const autopilotState = await readAutopilotRunState(root);
    expect(stages).toEqual(["planning", "suno_generation", "suno_generation", "completed"]);
    expect(events.some((event) => event.type === "song_take_completed" && event.songId === songId)).toBe(true);
    expect(song).toMatchObject({ status: "take_selected", selectedTakeId: "good-bass-cold-hook" });
    expect(autopilotState).toMatchObject({ stage: "completed", lastSuccessfulStage: "completed" });
    expect(autopilotState.currentSongId).toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
