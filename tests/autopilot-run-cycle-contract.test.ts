import { mkdtempSync } from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function rootWithSong(songId: string, status: "brief" | "suno_running"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-run-cycle-contract-"));
  await ensureArtistWorkspace(root);
  await ensureSongState(root, songId, "Contract Song");
  await updateSongState(root, songId, { status });
  return root;
}

describe("autopilot runCycle contract", () => {
  afterEach(() => {
    getRuntimeEventBus().clearForTest();
  });

  it("keeps a paused current song out of the music production lane", async () => {
    const root = await rootWithSong("paused-song", "brief");
    await writeAutopilotRunState(root, {
      runId: "paused-run",
      currentSongId: "paused-song",
      stage: "planning",
      paused: true,
      pausedReason: "operator pause",
      retryCount: 0,
      cycleCount: 0,
      updatedAt: "2026-06-11T00:00:00.000Z"
    });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, songSpawn: { enabled: false } }
    });
    unsubscribe();

    expect(state).toMatchObject({
      currentSongId: "paused-song",
      stage: "paused",
      paused: true,
      blockedReason: "operator pause"
    });
    expect(await readSongState(root, "paused-song")).toMatchObject({ status: "brief" });
    expect(await pathExists(join(root, "songs", "paused-song", "prompts", "prompt-pack-v001", "metadata.json"))).toBe(false);
    expect(events.some((event) => event.type === "prompt_pack_ready")).toBe(false);
    expect(events.some((event) => event.type === "song_take_completed")).toBe(false);
  });

  it("fails closed on a hard stop without advancing Suno or completion work", async () => {
    const root = await rootWithSong("hard-stop-song", "suno_running");
    await writeAutopilotRunState(root, {
      runId: "hard-stop-run",
      currentSongId: "hard-stop-song",
      stage: "suno_generation",
      paused: false,
      hardStopReason: "selector mismatch",
      retryCount: 1,
      cycleCount: 2,
      updatedAt: "2026-06-11T00:00:00.000Z"
    });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, songSpawn: { enabled: false } }
    });
    unsubscribe();

    expect(state).toMatchObject({
      currentSongId: "hard-stop-song",
      stage: "failed_closed",
      blockedReason: "selector mismatch"
    });
    expect(await readSongState(root, "hard-stop-song")).toMatchObject({ status: "suno_running" });
    expect(events.filter((event) => event.type === "suno_hard_stop")).toHaveLength(1);
    expect(events.some((event) => event.type === "suno_generate_retry")).toBe(false);
    expect(events.some((event) => event.type === "song_take_completed")).toBe(false);
  });
});
