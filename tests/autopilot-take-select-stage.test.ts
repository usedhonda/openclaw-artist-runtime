import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
async function seed(root: string, url: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "take-song", "Take Song");
  await writeSongBrief(root, "take-song", "# Brief\nMood: cold\nStyle notes: bass");
  await updateSongState(root, "take-song", { status: "takes_imported" });
  await mkdir(join(root, "songs", "take-song", "lyrics"), { recursive: true });
  await writeFile(join(root, "songs", "take-song", "lyrics", "lyrics.v1.md"), "hook chorus", "utf8");
  await mkdir(join(root, "songs", "take-song", "suno"), { recursive: true });
  await writeFile(join(root, "songs", "take-song", "suno", "latest-results.json"), JSON.stringify({ runId: "run-1", urls: [url] }), "utf8");
}

describe("autopilot take select stage", () => {
  it("scores imported takes and emits song_take_completed after stable selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-select-"));
    await seed(root, "https://suno.example/good-bass-cold-hook");
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
    });

    unsubscribe();
    expect(state).toMatchObject({
      stage: "completed",
      currentSongId: undefined,
      paused: false,
      suspendedAt: undefined,
      blockedReason: undefined,
      lastSuccessfulStage: "completed"
    });
    expect(await readSongState(root, "take-song")).toMatchObject({ status: "take_selected", selectedTakeId: "good-bass-cold-hook" });
    expect(events.some((event) => event.type === "song_take_completed")).toBe(true);
  });

  it("releases take_selected songs instead of holding producer review when Telegram producer-room is enabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-review-gate-"));
    await seed(root, "https://suno.example/good-bass-cold-hook");
    const service = new ArtistAutopilotService();
    const config = {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true },
      telegram: { enabled: true, pollIntervalMs: 2000, notifyStages: true, acceptFreeText: true }
    };

    const selected = await service.runCycle({ workspaceRoot: root, config });

    expect(selected).toMatchObject({
      stage: "completed",
      currentSongId: undefined,
      paused: false,
      suspendedAt: undefined,
      blockedReason: undefined,
      lastSuccessfulStage: "completed"
    });
    expect(await readSongState(root, "take-song")).toMatchObject({
      status: "take_selected",
      selectedTakeId: "good-bass-cold-hook"
    });
  });

  it("selects a low-score imported take and releases the lane", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-low-"));
    await seed(root, "https://suno.example/bad-noise");
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
    });

    unsubscribe();
    expect(state).toMatchObject({
      stage: "completed",
      currentSongId: undefined,
      paused: false,
      blockedReason: undefined,
      lastSuccessfulStage: "completed"
    });
    expect(await readSongState(root, "take-song")).toMatchObject({ status: "take_selected", selectedTakeId: "bad-noise" });
    expect(events.some((event) => event.type === "take_select_low_score")).toBe(false);
    expect(events.some((event) => event.type === "song_take_completed")).toBe(true);
  });
});
