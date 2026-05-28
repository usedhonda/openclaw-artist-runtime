import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, PRODUCER_REVIEW_SUSPENDED_AT, writeAutopilotRunState } from "../src/services/autopilotService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import {
  appendSpawnProposal,
  clearSpawnProposalQueueCacheForTest,
  loadSpawnProposalQueue
} from "../src/services/spawnProposalQueue";
import type { SpawnProposal } from "../src/types";

const originalSpawn = process.env.OPENCLAW_SONG_SPAWN_ENABLED;

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-idea-lane-"));
  await ensureArtistWorkspace(root);
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "obsessions: 東急ハンズ、若者、解散\nPlaces: 渋谷\nsound: low bass, nu-jazz\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Producer: ゆずるさん\nsentence_endings: だ。/な。/どう?\n", "utf8");
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  await writeFile(join(root, "observations", "2026-05-28.md"), "ハンズ前で解散したあと、若者の声だけが道路に残っていた。\n", "utf8");
  await ensureSongState(root, "song-026", "Matrix Jury");
  await updateSongState(root, "song-026", { status: "take_selected", reason: "producer review pending" });
  await writeAutopilotRunState(root, {
    runId: "producer-review",
    currentSongId: "song-026",
    stage: "take_selection",
    paused: true,
    pausedReason: "take selected after bounded one-shot Suno create; awaiting producer review",
    suspendedAt: PRODUCER_REVIEW_SUSPENDED_AT,
    blockedReason: PRODUCER_REVIEW_SUSPENDED_AT,
    retryCount: 0,
    cycleCount: 3,
    updatedAt: "2026-05-28T12:00:00.000Z"
  });
  return root;
}

function queuedProposal(id: string): SpawnProposal {
  return {
    proposalId: id,
    createdAt: `2026-05-28T00:00:0${id.at(-1) ?? "0"}.000Z`,
    status: "pending",
    title: `待機案 ${id}`,
    voiceTop: "ゆずるさん、次の案も置いておく。",
    coreTheme: `待機している別案 ${id}`,
    observationSources: [
      { kind: "news", label: "fixture", quote: "ハンズ前で人がほどけていた", url: "https://example.com/news" }
    ],
    motifRank: 3,
    cascadeTrace: {
      observationSources: [
        { kind: "news", label: "fixture", quote: "ハンズ前で人がほどけていた", url: "https://example.com/news" }
      ],
      artistVoice: "ゆずるさん、次の案も置いておく。",
      title: `待機案 ${id}`,
      lyricsTheme: `待機している別案 ${id}`,
      styleLayer: "low bass, dry drums"
    }
  };
}

describe("idea queue lane separation during producer review", () => {
  afterEach(() => {
    if (originalSpawn === undefined) {
      delete process.env.OPENCLAW_SONG_SPAWN_ENABLED;
    } else {
      process.env.OPENCLAW_SONG_SPAWN_ENABLED = originalSpawn;
    }
    vi.restoreAllMocks();
    getRuntimeEventBus().clearForTest();
    clearSpawnProposalQueueCacheForTest();
  });

  it("keeps the producer review currentSongId lane stopped while adding a new spawn proposal", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = await workspace();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: true },
        songSpawn: { enabled: true },
        telegram: { enabled: true },
        aiReview: { provider: "mock" }
      }
    });
    unsubscribe();
    const queue = await loadSpawnProposalQueue(root);

    expect(state).toMatchObject({
      currentSongId: "song-026",
      stage: "take_selection",
      paused: true,
      suspendedAt: PRODUCER_REVIEW_SUSPENDED_AT,
      blockedReason: PRODUCER_REVIEW_SUSPENDED_AT
    });
    expect(queue.filter((entry) => entry.status === "pending")).toHaveLength(1);
    expect(events.some((event) => event.type === "song_spawn_proposed")).toBe(true);
    expect(events.some((event) => event.type === "prompt_pack_ready")).toBe(false);
    expect(events.some((event) => event.type === "suno_generate_retry")).toBe(false);
    expect(events.some((event) => event.type === "song_take_completed")).toBe(false);
  });

  it("preserves the producer review stop when the idea queue is already full", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = await workspace();
    await appendSpawnProposal(root, queuedProposal("p1"));
    await appendSpawnProposal(root, queuedProposal("p2"));
    await appendSpawnProposal(root, queuedProposal("p3"));
    getRuntimeEventBus().clearForTest();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: true },
        songSpawn: { enabled: true },
        telegram: { enabled: true },
        aiReview: { provider: "mock" }
      }
    });
    unsubscribe();

    expect(state).toMatchObject({
      currentSongId: "song-026",
      stage: "take_selection",
      paused: true,
      suspendedAt: PRODUCER_REVIEW_SUSPENDED_AT,
      blockedReason: PRODUCER_REVIEW_SUSPENDED_AT
    });
    expect((await loadSpawnProposalQueue(root)).filter((entry) => entry.status === "pending")).toHaveLength(3);
    expect(events).toContainEqual(expect.objectContaining({
      type: "spawn_proposal_skip_queue_full",
      limit: 3,
      pendingCount: 3
    }));
    expect(events.some((event) => event.type === "song_spawn_proposed")).toBe(false);
  });
});
