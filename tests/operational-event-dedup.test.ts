import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService, shouldEmitOperationalEpisode, writeAutopilotRunState } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";

function workspace(prefix: string): string {
  getRuntimeEventBus().clearForTest();
  return mkdtempSync(join(tmpdir(), prefix));
}

async function seedTakePendingSong(root: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "take-pending", "Take Pending");
  await writeSongBrief(root, "take-pending", "# Brief\nMood: cold\nStyle notes: sparse");
  await updateSongState(root, "take-pending", { status: "takes_imported" });
  await mkdir(join(root, "songs", "take-pending", "lyrics"), { recursive: true });
  await writeFile(join(root, "songs", "take-pending", "lyrics", "lyrics.v1.md"), "hook chorus", "utf8");
}

async function seedBudgetSong(root: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "budget-song", "Budget Song");
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId: "budget-song",
    songTitle: "Budget Song",
    artistReason: "test",
    lyricsText: "dead neon",
    knowledgePackVersion: "test"
  });
  await updateSongState(root, "budget-song", { status: "suno_prompt_pack" });
}

describe("operational event dedup", () => {
  it("emits take selection stalled only once while the pending reason is unchanged", async () => {
    const root = workspace("artist-runtime-take-stalled-dedup-");
    await seedTakePendingSong(root);
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const service = new ArtistAutopilotService();

    await service.runCycle({ workspaceRoot: root, config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } } });
    await service.runCycle({ workspaceRoot: root, config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } } });
    unsubscribe();

    expect(events.filter((event) => event.type === "take_select_pending")).toHaveLength(1);
    expect(events.filter((event) => event.type === "take_selection_stalled")).toHaveLength(1);
  });

  it("emits suno generate retry only once while the retry wait reason is unchanged", async () => {
    const root = workspace("artist-runtime-retry-dedup-");
    await seedBudgetSong(root);
    const lastRunAt = new Date().toISOString();
    await writeAutopilotRunState(root, {
      runId: "retry-run",
      currentSongId: "budget-song",
      stage: "suno_generation",
      paused: false,
      retryCount: 1,
      cycleCount: 1,
      updatedAt: lastRunAt,
      lastRunAt
    });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const service = new ArtistAutopilotService();
    const config = { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, music: { suno: { driver: "playwright" as const } } };

    await service.runCycle({ workspaceRoot: root, config });
    await service.runCycle({ workspaceRoot: root, config });
    unsubscribe();

    expect(events.filter((event) => event.type === "suno_generate_retry")).toHaveLength(1);
  });

  it("classifies an unchanged asset-generation stall as the same operational episode", () => {
    const marker = "asset_generation_stalled:cannot prepare social assets before take selection for song-1";
    expect(shouldEmitOperationalEpisode({ stage: "asset_generation", paused: false, retryCount: 0, cycleCount: 1, updatedAt: "2026-06-19T00:00:00.000Z" }, marker)).toBe(true);
    expect(shouldEmitOperationalEpisode({ stage: "asset_generation", paused: false, retryCount: 0, cycleCount: 1, updatedAt: "2026-06-19T00:00:00.000Z", blockedReason: marker }, marker)).toBe(false);
  });
});
