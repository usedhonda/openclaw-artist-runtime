import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { tryConsumeBudget } from "../src/services/sunoBudgetLedger";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-autopilot-cycle-e2e-"));
}

async function seedSongForSuno(root: string, songId = "song-001"): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, songId, "Budget Ghost");
  await writeFile(join(root, "songs", songId, "lyrics", "lyrics.v1.md"), "dead neon\n", "utf8").catch(async () => {
    await mkdir(join(root, "songs", songId, "lyrics"), { recursive: true });
    await writeFile(join(root, "songs", songId, "lyrics", "lyrics.v1.md"), "dead neon\n", "utf8");
  });
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId,
    songTitle: "Budget Ghost",
    artistReason: "test",
    lyricsText: "dead neon",
    knowledgePackVersion: "test"
  });
}

describe("autopilot autonomous production loop", () => {
  it("emits theme generation while creating a song idea without changing dry-run posture", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const service = new ArtistAutopilotService();

    const state = await service.runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
    });

    unsubscribe();
    expect(state.currentSongId).toBeTruthy();
    expect(events.some((event) => event.type === "theme_generated")).toBe(true);
    expect((await service.status(true, true, root)).dryRun).toBe(true);
  });

  it("skips Suno generation when the daily budget is exhausted", async () => {
    const root = workspace();
    await seedSongForSuno(root);
    vi.stubEnv("OPENCLAW_SUNO_DAILY_BUDGET", "1");
    await tryConsumeBudget(root, 1, new Date());
    const service = new ArtistAutopilotService();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await service.runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
    });

    unsubscribe();
    vi.unstubAllEnvs();
    expect(state.blockedReason).toContain("budget exhausted");
    expect(events.some((event) => event.type === "budget_exhausted")).toBe(true);
  }, 30_000);

  it("emits song_take_completed after take selection", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-001", "Take Ghost");
    await updateSongState(root, "song-001", { status: "takes_imported" });
    await mkdir(join(root, "songs", "song-001", "suno"), { recursive: true });
    await writeFile(
      join(root, "songs", "song-001", "suno", "latest-results.json"),
      JSON.stringify({ runId: "run-1", urls: ["https://suno.example/take-1"] }),
      "utf8"
    );
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } }
    });

    unsubscribe();
    expect(events).toContainEqual(expect.objectContaining({
      type: "song_take_completed",
      songId: "song-001",
      selectedTakeId: "take-1"
    }));
  });
});
