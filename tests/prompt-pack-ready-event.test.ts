import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService, readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

const completeBrief = [
  "# Brief",
  "- Mood: cold",
  "- Tempo: 128 BPM",
  "- Duration: 4 min",
  "- Style notes: thick bass",
  "- Lyrics theme: city ruins"
].join("\n");

async function seedPromptPackSong(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-prompt-pack-ready-"));
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "song-ready", "Song Ready");
  await writeSongBrief(root, "song-ready", completeBrief);
  await writeAutopilotRunState(root, {
    runId: "prompt-ready",
    currentSongId: "song-ready",
    stage: "planning",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    lastSuccessfulStage: "planning"
  });
  return root;
}

describe("prompt_pack_ready event", () => {
  it("emits prompt pack approval event and suspends before Suno when Telegram is enabled", async () => {
    const root = await seedPromptPackSong();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, telegram: { enabled: true } }
    });
    const stored = await readAutopilotRunState(root);
    unsubscribe();

    const ready = events.find((event): event is Extract<RuntimeEvent, { type: "prompt_pack_ready" }> => event.type === "prompt_pack_ready");
    expect(state).toMatchObject({ stage: "prompt_pack", suspendedAt: "prompt_pack_ready" });
    expect(stored.suspendedAt).toBe("prompt_pack_ready");
    expect(ready).toMatchObject({ songId: "song-ready", title: "Song Ready" });
    expect(ready?.tempo).toMatch(/\d{2,3}\s*BPM/);
    expect(ready?.lyricsExcerpt.split("\n").length).toBeGreaterThan(0);
  });

  it("keeps a suspended prompt pack from advancing on the next cycle", async () => {
    const root = await seedPromptPackSong();
    const service = new ArtistAutopilotService();

    await service.runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, telegram: { enabled: true } }
    });
    const next = await service.runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, telegram: { enabled: true } }
    });

    expect(next.stage).toBe("prompt_pack");
    expect(next.blockedReason).toBe("prompt_pack_ready");
  });
});
