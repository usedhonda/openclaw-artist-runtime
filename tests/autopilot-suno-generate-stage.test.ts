import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { importSunoResults, readLatestSunoRun } from "../src/services/sunoRuns";

const completeBrief = [
  "# Brief",
  "- Mood: cold",
  "- Tempo: 128 BPM",
  "- Duration: 4 min",
  "- Style notes: thick bass",
  "- Lyrics theme: city ruins"
].join("\n");

async function seedPlanningSong(root: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "suno-stage", "Suno Stage");
  await writeSongBrief(root, "suno-stage", completeBrief);
  await writeAutopilotRunState(root, {
    runId: "suno-stage",
    currentSongId: "suno-stage",
    stage: "planning",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    lastSuccessfulStage: "planning"
  });
}

describe("autopilot Suno generate stage", () => {
  it("bridges planning through Suno generation into take selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-autopilot-suno-stage-"));
    await seedPlanningSong(root);
    const service = new ArtistAutopilotService();
    const config = { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, music: { suno: { driver: "playwright" as const } }, telegram: { enabled: false } };
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const promptPack = await service.runCycle({ workspaceRoot: root, config });
    const suno = await service.runCycle({ workspaceRoot: root, config });
    const run = await readLatestSunoRun(root, "suno-stage");
    await importSunoResults({
      workspaceRoot: root,
      songId: "suno-stage",
      runId: run?.runId ?? "dry-run",
      urls: ["https://suno.example/take-1"]
    });
    const take = await service.runCycle({ workspaceRoot: root, config });

    unsubscribe();
    expect(promptPack.stage).toBe("prompt_pack");
    expect(suno.stage).toBe("suno_generation");
    expect(run?.status).toBe("blocked_dry_run");
    expect(take.stage).toBe("take_selection");
    expect(await readSongState(root, "suno-stage")).toMatchObject({ status: "take_selected" });
    expect(events.some((event) => event.type === "song_take_completed")).toBe(true);
  });

  it("keeps generation in retry state instead of failed_closed when Suno payload is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-autopilot-suno-retry-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "retry-song", "Retry Song");
    await updateSongState(root, "retry-song", { status: "suno_prompt_pack" });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, music: { suno: { driver: "playwright" as const } } }
    });

    unsubscribe();
    expect(state.stage).toBe("suno_generation");
    expect(state.retryCount).toBe(1);
    expect(state.blockedReason).toContain("suno_generate_retry");
    expect(events.some((event) => event.type === "suno_generate_retry")).toBe(true);
  });

  it("pauses after repeated Suno generation failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-autopilot-suno-failed-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "failed-song", "Failed Song");
    await updateSongState(root, "failed-song", { status: "suno_prompt_pack" });
    await writeAutopilotRunState(root, {
      runId: "failed-song",
      currentSongId: "failed-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 2,
      cycleCount: 0,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, music: { suno: { driver: "playwright" as const } } }
    });

    unsubscribe();
    expect(state.stage).toBe("paused");
    expect(state.paused).toBe(true);
    expect(state.retryCount).toBe(3);
    expect(state.blockedReason).toContain("suno_generate_failed");
    expect(events.some((event) => event.type === "suno_generate_failed")).toBe(true);
  });
});
