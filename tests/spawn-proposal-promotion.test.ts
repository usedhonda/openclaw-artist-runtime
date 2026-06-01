import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { markCallbackResolved, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import {
  appendSpawnProposal,
  clearSpawnProposalQueueCacheForTest,
  loadSpawnProposalQueue
} from "../src/services/spawnProposalQueue";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import type { CommissionBrief, SpawnProposal } from "../src/types";

const originalSpawn = process.env.OPENCLAW_SONG_SPAWN_ENABLED;

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-spawn-proposal-promotion-"));
}

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

function brief(songId = "spawn_waiting"): CommissionBrief {
  return {
    songId,
    title: "ハンズ前、解散",
    brief: "東急ハンズ前の待ち合わせを曲にする。",
    lyricsTheme: "ハンズ前で解散する若者の距離を短いサビに畳む。",
    mood: "tense",
    tempo: "142 BPM",
    duration: "2:45",
    styleNotes: "thick bass, restrained hi-hats, dry male vocal",
    sourceText: "test",
    createdAt: "2026-05-28T00:00:00.000Z"
  };
}

function proposal(songId = "spawn_waiting"): SpawnProposal {
  return {
    proposalId: songId,
    createdAt: "2026-05-28T00:00:00.000Z",
    status: "draft",
    title: "ハンズ前、解散",
    voiceTop: "ゆずるさん、ハンズ前、解散で行く案がある。",
    coreTheme: "ハンズ前で解散する若者の距離を切る",
    observationSources: [
      { kind: "news", label: "news", quote: "ハンズ前に人が残っている", url: "https://example.com/news" }
    ],
    motifRank: 1,
    cascadeTrace: {
      observationSources: [
        { kind: "news", label: "news", quote: "ハンズ前に人が残っている", url: "https://example.com/news" }
      ],
      artistVoice: "ゆずるさん、ハンズ前、解散で行く案がある。",
      title: "ハンズ前、解散",
      lyricsTheme: "ハンズ前で解散する若者の距離を切る",
      styleLayer: "thick bass, restrained hi-hats, dry male vocal"
    }
  };
}

async function registerInject(root: string, songId = "spawn_waiting") {
  return registerCallbackAction(root, {
    action: "song_spawn_inject",
    proposalId: songId,
    songId,
    commissionBrief: brief(songId),
    spawnReason: "producer approved queue proposal",
    chatId: 123,
    messageId: 77,
    userId: 123,
    now: Date.parse("2026-05-28T00:00:00.000Z")
  });
}

describe("spawn proposal draft-box creation", () => {
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

  it("starts building a draft immediately when currentSongId is empty", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = workspace();
    await ensureArtistWorkspace(root);
    await appendSpawnProposal(root, proposal());
    const entry = await registerInject(root);

    const result = await routeTelegramCallback({
      root,
      client: client(),
      callbackQueryId: "inject-now",
      data: `cb:${entry.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });

    expect(result).toMatchObject({ result: "applied", reason: "song_spawn_injected" });
    expect(await readAutopilotRunState(root)).toMatchObject({
      currentSongId: "spawn_waiting",
      stage: "planning",
      suspendedAt: null
    });
    expect(await readSongState(root, "spawn_waiting")).toMatchObject({ status: "brief" });
    expect((await loadSpawnProposalQueue(root)).find((entry) => entry.proposalId === "spawn_waiting")).toMatchObject({ status: "building" });
  });

  it("rejects a second create while another song owns currentSongId without creating a waiting queue", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = workspace();
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-active", "前の曲");
    await updateSongState(root, "song-active", { status: "suno_running", reason: "test busy lane" });
    await writeAutopilotRunState(root, {
      runId: "active-run",
      currentSongId: "song-active",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: "2026-05-28T00:00:00.000Z"
    });
    await appendSpawnProposal(root, proposal());
    const entry = await registerInject(root);
    const result = await routeTelegramCallback({
      root,
      client: client(),
      callbackQueryId: "inject-wait",
      data: `cb:${entry.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });

    expect(result).toMatchObject({ result: "blocked", reason: "draft_box_building_busy" });
    expect(await readAutopilotRunState(root)).toMatchObject({ currentSongId: "song-active", stage: "suno_generation" });
    expect((await loadSpawnProposalQueue(root)).find((entry) => entry.proposalId === "spawn_waiting")).toMatchObject({ status: "draft" });
  });

  it("does not auto-promote old accepted_waiting ledger rows after the current song is released", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = workspace();
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-active", "前の曲");
    await updateSongState(root, "song-active", { status: "archived", reason: "producer archived" });
    await writeAutopilotRunState(root, {
      runId: "active-run",
      currentSongId: "song-active",
      stage: "take_selection",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: "2026-05-28T00:00:00.000Z"
    });
    await appendSpawnProposal(root, proposal());
    const entry = await registerInject(root);
    await markCallbackResolved(root, entry.callbackId, {
      status: "applied",
      reason: "song_spawn_injected",
      now: Date.parse("2026-05-28T00:01:00.000Z")
    });
    await appendSpawnProposal(root, { ...proposal(), status: "accepted_waiting" as never });

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: true },
        songSpawn: { enabled: true }
      }
    });

    expect(state).toMatchObject({
      currentSongId: undefined,
      stage: "planning"
    });
    expect((await readSongState(root, "spawn_waiting")).status).toBe("idea");
    expect((await loadSpawnProposalQueue(root)).find((entry) => entry.proposalId === "spawn_waiting")).toMatchObject({ status: "draft" });
  });
});
