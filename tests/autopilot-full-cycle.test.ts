import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

import { ArtistAutopilotService, readAutopilotRunState } from "../src/services/autopilotService";
import { readSongState } from "../src/services/artistState";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readLatestSocialAction } from "../src/services/socialPublishing";
import { readLatestSunoRun, importSunoResults } from "../src/services/sunoRuns";

describe("ArtistAutopilotService full dry-run cycle", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("walks two dry-run cycles across two songs without external side effects", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-full-cycle-"));
    await ensureArtistWorkspace(root);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ArtistAutopilotService();
    const config = {
      artist: { workspaceRoot: root },
      autopilot: {
        enabled: true,
        dryRun: true
      },
      music: {
        suno: { driver: "playwright" as const }
      },
      distribution: {
        enabled: true,
        platforms: {
          x: { enabled: true }
        }
      }
    };

    const cycleStages: string[] = [];

    const first = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(first.stage);
    const firstSongId = first.currentSongId ?? "song-001";
    const second = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(second.stage);
    const third = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(third.stage);

    const firstGeneratedRun = await readLatestSunoRun(root, firstSongId);
    expect(firstGeneratedRun?.status).toBe("blocked_dry_run");
    await importSunoResults({
      workspaceRoot: root,
      songId: firstSongId,
      runId: firstGeneratedRun?.runId ?? "dry-run-import-1",
      urls: ["https://example.com/takes/auto-1"]
    });

    const fourth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(fourth.stage);
    const fifth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(fifth.stage);
    const sixth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(sixth.stage);
    const seventh = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(seventh.stage);
    const eighth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(eighth.stage);

    const secondSongId = eighth.currentSongId ?? "song-002";
    const ninth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(ninth.stage);
    const tenth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(tenth.stage);

    const secondGeneratedRun = await readLatestSunoRun(root, secondSongId);
    expect(secondGeneratedRun?.status).toBe("blocked_dry_run");
    await importSunoResults({
      workspaceRoot: root,
      songId: secondSongId,
      runId: secondGeneratedRun?.runId ?? "dry-run-import-2",
      urls: ["https://example.com/takes/auto-2"]
    });

    const eleventh = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(eleventh.stage);
    const twelfth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(twelfth.stage);
    const thirteenth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(thirteenth.stage);
    const fourteenth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(fourteenth.stage);

    const [
      firstBrief,
      firstLyrics,
      firstPromptPackMetadata,
      firstRunsLedger,
      firstSelectedTake,
      firstSocialAssets,
      firstSocialLedger,
      secondBrief,
      secondLyrics,
      secondPromptPackMetadata,
      secondRunsLedger,
      secondSelectedTake,
      secondSocialAssets,
      secondSocialLedger
    ] = await Promise.all([
      readFile(join(root, "songs", firstSongId, "brief.md"), "utf8"),
      readFile(join(root, "songs", firstSongId, "lyrics", "lyrics.v1.md"), "utf8"),
      readFile(join(root, "songs", firstSongId, "prompts", "prompt-pack-v001", "metadata.json"), "utf8"),
      readFile(join(root, "songs", firstSongId, "suno", "runs.jsonl"), "utf8"),
      readFile(join(root, "songs", firstSongId, "suno", "selected-take.json"), "utf8"),
      readFile(join(root, "songs", firstSongId, "social", "assets.json"), "utf8"),
      readFile(join(root, "songs", firstSongId, "social", "social-publish.jsonl"), "utf8"),
      readFile(join(root, "songs", secondSongId, "brief.md"), "utf8"),
      readFile(join(root, "songs", secondSongId, "lyrics", "lyrics.v1.md"), "utf8"),
      readFile(join(root, "songs", secondSongId, "prompts", "prompt-pack-v001", "metadata.json"), "utf8"),
      readFile(join(root, "songs", secondSongId, "suno", "runs.jsonl"), "utf8"),
      readFile(join(root, "songs", secondSongId, "suno", "selected-take.json"), "utf8"),
      readFile(join(root, "songs", secondSongId, "social", "assets.json"), "utf8"),
      readFile(join(root, "songs", secondSongId, "social", "social-publish.jsonl"), "utf8")
    ]);
    const [firstSongState, secondSongState, latestSocialAction, autopilotState] = await Promise.all([
      readSongState(root, firstSongId),
      readSongState(root, secondSongId),
      readLatestSocialAction(root, secondSongId),
      readAutopilotRunState(root)
    ]);

    expect(cycleStages).toEqual([
      "planning",
      "prompt_pack",
      "suno_generation",
      "take_selection",
      "asset_generation",
      "publishing",
      "completed",
      "planning",
      "prompt_pack",
      "suno_generation",
      "take_selection",
      "asset_generation",
      "publishing",
      "completed"
    ]);
    expect(second.lastSuccessfulStage).toBe("prompt_pack");
    expect(third.blockedReason).toContain("waiting for Suno result import");
    expect(sixth.blockedReason).toContain("dry-run");
    expect(seventh.lastSuccessfulStage).toBe("completed");

    expect(firstSongId).toBe("song-001");
    expect(secondSongId).toBe("song-002");
    expect(firstBrief).toContain("Why this song exists");
    expect(firstLyrics).toContain("A public-facing song");
    expect(firstPromptPackMetadata).toContain("\"version\": 1");
    expect(firstRunsLedger).toContain("\"status\":\"blocked_dry_run\"");
    expect(firstRunsLedger).toContain("\"status\":\"imported\"");
    expect(firstSelectedTake).toContain("\"selectedTakeId\"");
    expect(firstSocialAssets).toContain("\"platform\": \"x\"");
    expect(firstSocialLedger).toContain("\"action\":\"publish\"");
    expect(firstSocialLedger).toContain("\"dryRun\":true");
    expect(firstSongState.status).toBe("published");
    expect(firstSongState.lastReason).toContain("dry-run publish simulated");

    expect(secondBrief).toContain("Why this song exists");
    expect(secondLyrics).toContain("A public-facing song");
    expect(secondPromptPackMetadata).toContain("\"version\": 1");
    expect(secondRunsLedger).toContain("\"status\":\"blocked_dry_run\"");
    expect(secondRunsLedger).toContain("\"status\":\"imported\"");
    expect(secondSelectedTake).toContain("\"selectedTakeId\"");
    expect(secondSocialAssets).toContain("\"platform\": \"x\"");
    expect(secondSocialLedger).toContain("\"action\":\"publish\"");
    expect(secondSocialLedger).toContain("\"dryRun\":true");
    expect(secondSongState.status).toBe("published");
    expect(secondSongState.lastReason).toContain("dry-run publish simulated");

    expect(latestSocialAction?.accepted).toBe(false);
    expect(latestSocialAction?.reason).toContain("dry-run");
    expect(autopilotState.stage).toBe("completed");
    expect(autopilotState.currentSongId).toBe(secondSongId);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
