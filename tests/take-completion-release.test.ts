import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { markCallbackResolved, registerCallbackAction } from "../src/services/callbackActionRegistry";
import {
  appendSpawnProposal,
  clearSpawnProposalQueueCacheForTest,
  loadSpawnProposalQueue
} from "../src/services/spawnProposalQueue";
import type { CommissionBrief, SpawnProposal } from "../src/types";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-take-completion-release-"));
}

async function seedImportedTake(root: string): Promise<void> {
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "take-song", "Take Song");
  await writeSongBrief(root, "take-song", "# Brief\nMood: cold\nStyle notes: bass");
  await updateSongState(root, "take-song", { status: "takes_imported" });
  await mkdir(join(root, "songs", "take-song", "lyrics"), { recursive: true });
  await writeFile(join(root, "songs", "take-song", "lyrics", "lyrics.v1.md"), "hook chorus", "utf8");
  await mkdir(join(root, "songs", "take-song", "suno"), { recursive: true });
  await writeFile(join(root, "songs", "take-song", "suno", "latest-results.json"), JSON.stringify({
    runId: "run-1",
    urls: ["https://suno.example/good-bass-cold-hook"]
  }), "utf8");
}

function brief(songId = "spawn_waiting"): CommissionBrief {
  return {
    songId,
    title: "次の曲",
    brief: "前の曲の完成を待ってから作る。",
    lyricsTheme: "待機していた次の曲を短いサビにする。",
    mood: "tense",
    tempo: "142 BPM",
    duration: "2:45",
    styleNotes: "thick bass, restrained hi-hats, dry male vocal",
    sourceText: "test",
    createdAt: "2026-05-29T00:00:00.000Z"
  };
}

function draftProposal(songId = "spawn_waiting"): SpawnProposal {
  return {
    proposalId: songId,
    createdAt: "2026-05-29T00:00:00.000Z",
    status: "draft",
    title: "次の曲",
    voiceTop: "ゆずるさん、次の曲は待ってる。",
    coreTheme: "完成後に次の曲へ進む",
    observationSources: [],
    motifRank: 1,
    cascadeTrace: {
      observationSources: [],
      artistVoice: "ゆずるさん、次の曲は待ってる。",
      title: "次の曲",
      lyricsTheme: "待機していた次の曲を短いサビにする。",
      styleLayer: "thick bass, restrained hi-hats, dry male vocal"
    }
  };
}

async function seedAcceptedWaiting(root: string, songId = "spawn_waiting"): Promise<void> {
  await appendSpawnProposal(root, draftProposal(songId));
  const action = await registerCallbackAction(root, {
    action: "song_spawn_inject",
    proposalId: songId,
    songId,
    commissionBrief: brief(songId),
    chatId: 123,
    messageId: 456,
    userId: 123,
    now: Date.parse("2026-05-29T00:00:00.000Z")
  });
  await markCallbackResolved(root, action.callbackId, {
    status: "applied",
    reason: "song_spawn_injected",
    now: Date.parse("2026-05-29T00:01:00.000Z")
  });
}

describe("take completion release contract", () => {
  it("releases currentSongId after take selection and does not promote another draft automatically", async () => {
    clearSpawnProposalQueueCacheForTest();
    const root = workspace();
    await seedImportedTake(root);
    await seedAcceptedWaiting(root);
    const service = new ArtistAutopilotService();
    const config = {
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true },
      songSpawn: { enabled: false }
    };

    const completed = await service.runCycle({ workspaceRoot: root, config });

    expect(completed).toMatchObject({
      stage: "completed",
      currentSongId: undefined,
      paused: false,
      blockedReason: undefined,
      lastSuccessfulStage: "completed"
    });
    expect(await readSongState(root, "take-song")).toMatchObject({
      status: "take_selected",
      selectedTakeId: "good-bass-cold-hook"
    });

    expect((await loadSpawnProposalQueue(root)).find((entry) => entry.proposalId === "spawn_waiting")).toMatchObject({ status: "draft" });
  });

  it("keeps the lane released after take completion when there is no draft creation in progress", async () => {
    clearSpawnProposalQueueCacheForTest();
    const root = workspace();
    await seedImportedTake(root);
    await writeAutopilotRunState(root, {
      runId: "take-release-run",
      currentSongId: "take-song",
      stage: "take_selection",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: "2026-05-29T00:00:00.000Z"
    });

    const completed = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, songSpawn: { enabled: false } }
    });

    expect(completed).toMatchObject({
      stage: "completed",
      currentSongId: undefined,
      blockedReason: undefined
    });
    expect(await readSongState(root, "take-song")).toMatchObject({ status: "take_selected" });
  });
});
