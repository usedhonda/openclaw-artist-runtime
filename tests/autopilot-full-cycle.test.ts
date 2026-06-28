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
import { readLatestSunoRun, importSunoResults } from "../src/services/sunoRuns";

describe("ArtistAutopilotService full dry-run cycle", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("walks two dry-run cycles across two songs without external side effects", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-full-cycle-"));
    await ensureArtistWorkspace(root);

    const emptyNewsRss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>`;
    const fetchMock = vi.fn().mockResolvedValue(new Response(emptyNewsRss, { status: 200 }));
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
    const secondSongId = fifth.currentSongId ?? "song-002";
    const sixth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(sixth.stage);
    const seventh = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(seventh.stage);

    const secondGeneratedRun = await readLatestSunoRun(root, secondSongId);
    expect(secondGeneratedRun?.status).toBe("blocked_dry_run");
    await importSunoResults({
      workspaceRoot: root,
      songId: secondSongId,
      runId: secondGeneratedRun?.runId ?? "dry-run-import-2",
      urls: ["https://example.com/takes/auto-2"]
    });

    const eighth = await service.runCycle({ workspaceRoot: root, config });
    cycleStages.push(eighth.stage);

    const [
      firstBrief,
      firstLyrics,
      firstPromptPackMetadata,
      firstRunsLedger,
      firstSelectedTake,
      secondBrief,
      secondLyrics,
      secondPromptPackMetadata,
      secondRunsLedger,
      secondSelectedTake
    ] = await Promise.all([
      readFile(join(root, "songs", firstSongId, "brief.md"), "utf8"),
      readFile(join(root, "songs", firstSongId, "lyrics", "lyrics.v1.md"), "utf8"),
      readFile(join(root, "songs", firstSongId, "prompts", "prompt-pack-v001", "metadata.json"), "utf8"),
      readFile(join(root, "songs", firstSongId, "suno", "runs.jsonl"), "utf8"),
      readFile(join(root, "songs", firstSongId, "suno", "selected-take.json"), "utf8"),
      readFile(join(root, "songs", secondSongId, "brief.md"), "utf8"),
      readFile(join(root, "songs", secondSongId, "lyrics", "lyrics.v1.md"), "utf8"),
      readFile(join(root, "songs", secondSongId, "prompts", "prompt-pack-v001", "metadata.json"), "utf8"),
      readFile(join(root, "songs", secondSongId, "suno", "runs.jsonl"), "utf8"),
      readFile(join(root, "songs", secondSongId, "suno", "selected-take.json"), "utf8")
    ]);
    const [firstSongState, secondSongState, autopilotState] = await Promise.all([
      readSongState(root, firstSongId),
      readSongState(root, secondSongId),
      readAutopilotRunState(root)
    ]);

    expect(cycleStages).toEqual([
      "planning",
      "prompt_pack",
      "suno_generation",
      "completed",
      "planning",
      "prompt_pack",
      "suno_generation",
      "completed"
    ]);
    expect(second.lastSuccessfulStage).toBe("prompt_pack");
    expect(third.blockedReason).toContain("waiting for Suno result import");
    expect(fourth.lastSuccessfulStage).toBe("completed");
    expect(seventh.blockedReason).toContain("waiting for Suno result import");
    expect(eighth.lastSuccessfulStage).toBe("completed");

    expect(firstSongId).toBe("song-001");
    expect(secondSongId).toBe("song-002");
    expect(firstBrief).toContain("Why this song exists");
    expect(firstLyrics).toContain("[Verse");
    expect(firstLyrics).toContain("[Hook");
    expect(firstPromptPackMetadata).toContain("\"version\": 1");
    expect(firstRunsLedger).toContain("\"status\":\"blocked_dry_run\"");
    expect(firstRunsLedger).toContain("\"status\":\"imported\"");
    expect(firstSelectedTake).toContain("\"selectedTakeId\"");
    expect(firstSongState.status).toBe("take_selected");

    expect(secondBrief).toContain("Why this song exists");
    expect(secondLyrics).toContain("[Verse");
    expect(secondLyrics).toContain("[Hook");
    expect(secondPromptPackMetadata).toContain("\"version\": 1");
    expect(secondRunsLedger).toContain("\"status\":\"blocked_dry_run\"");
    expect(secondRunsLedger).toContain("\"status\":\"imported\"");
    expect(secondSelectedTake).toContain("\"selectedTakeId\"");
    expect(secondSongState.status).toBe("take_selected");

    expect(autopilotState.stage).toBe("completed");
    expect(autopilotState.currentSongId).toBeUndefined();

    expect(spawnMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every((call) => String(call[0]).startsWith("https://news.google.com/rss/search?"))).toBe(
      true
    );

    vi.unstubAllGlobals();
  });
});
