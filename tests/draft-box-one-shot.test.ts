import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState } from "../src/services/artistState";
import { ArtistAutopilotService, readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { appendSpawnProposal, clearSpawnProposalQueueCacheForTest, loadSpawnProposalQueue } from "../src/services/spawnProposalQueue";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import type { CommissionBrief, SpawnProposal } from "../src/types";

const originalSpawn = process.env.OPENCLAW_SONG_SPAWN_ENABLED;

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-draft-box-one-shot-"));
}

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

function brief(songId = "spawn_old_draft"): CommissionBrief {
  return {
    songId,
    title: songId === "spawn_d554cf" ? "安全圏の芝" : "古い草稿",
    brief: "古い観察から凍結された草稿を曲にする。",
    lyricsTheme: "古い観察を今日の素材に混ぜず、短いサビに畳む。",
    mood: "tense",
    tempo: "142 BPM",
    duration: "2:45",
    styleNotes: "dry male vocal, thick bass, tight drums",
    sourceText: "frozen draft fixture",
    createdAt: "2026-05-20T00:00:00.000Z",
    sources: [
      { kind: "news", url: "https://example.com/frozen", author: "fixture", quote: "凍った観察だけを使う" }
    ]
  };
}

function proposal(songId = "spawn_old_draft", status: SpawnProposal["status"] = "draft"): SpawnProposal {
  const commission = brief(songId);
  return {
    proposalId: songId,
    createdAt: commission.createdAt,
    status,
    title: commission.title,
    voiceTop: "この草稿で作る。古い観察は凍らせたまま行く。",
    coreTheme: commission.lyricsTheme,
    observationSources: [
      { kind: "news", label: "fixture", quote: "凍った観察だけを使う", url: "https://example.com/frozen" }
    ],
    motifRank: 4,
    cascadeTrace: {
      observationSources: [
        { kind: "news", label: "fixture", quote: "凍った観察だけを使う", url: "https://example.com/frozen" }
      ],
      artistVoice: "この草稿で作る。古い観察は凍らせたまま行く。",
      title: commission.title,
      lyricsTheme: commission.lyricsTheme,
      styleLayer: commission.styleNotes
    }
  };
}

async function registerCreate(root: string, songId: string) {
  return registerCallbackAction(root, {
    action: "song_spawn_inject",
    proposalId: songId,
    songId,
    commissionBrief: brief(songId),
    spawnReason: "producer clicked create from persistent draft box",
    chatId: 123,
    messageId: 77,
    userId: 123,
    // routeTelegramCallback uses the real clock for expiry checks, so register relative to now.
    now: Date.now()
  });
}

async function prepareRoot(root: string): Promise<void> {
  clearSpawnProposalQueueCacheForTest();
  await ensureArtistWorkspace(root);
  await mkdir(join(root, "observations"), { recursive: true });
  await writeFile(join(root, "observations", "today.md"), "今日の観察は混ぜない。\n", "utf8");
}

async function clickCreate(root: string, songId: string): Promise<void> {
  const action = await registerCreate(root, songId);
  const result = await routeTelegramCallback({
    root,
    client: client(),
    callbackQueryId: `create-${songId}`,
    data: `cb:${action.callbackId}`,
    fromUserId: 123,
    chatId: 123,
    messageId: 77
  });
  expect(result).toMatchObject({ result: "applied", reason: "song_spawn_injected" });
}

async function runUntilCompleted(root: string, songId: string): Promise<RuntimeEvent[]> {
  const service = new ArtistAutopilotService();
  const events: RuntimeEvent[] = [];
  const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
  const config = {
    artist: { workspaceRoot: root },
    autopilot: { enabled: true, dryRun: true },
    telegram: { enabled: true },
    songSpawn: { enabled: false },
    music: { suno: { driver: "mock" as const } }
  };
  let completed = false;

  for (let i = 0; i < 5; i += 1) {
    const state = await service.runCycle({ workspaceRoot: root, config });
    if (state.stage === "completed") {
      expect(state.currentSongId).toBeUndefined();
      completed = true;
      break;
    }
  }
  unsubscribe();
  expect(completed).toBe(true);
  expect(await readSongState(root, songId)).toMatchObject({ status: "take_selected" });
  expect(await readAutopilotRunState(root)).toMatchObject({ stage: "completed" });
  return events;
}

describe("persistent draft box one-shot create", () => {
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

  it("creates an old draft through private completion using frozen sources", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = workspace();
    await prepareRoot(root);
    await appendSpawnProposal(root, proposal());

    await clickCreate(root, "spawn_old_draft");
    const events = await runUntilCompleted(root, "spawn_old_draft");

    const briefMd = await readFile(join(root, "songs", "spawn_old_draft", "brief.md"), "utf8");
    expect(briefMd).toContain("## Frozen sources");
    expect(briefMd).toContain("https://example.com/frozen");
    expect(briefMd).not.toContain("今日の観察は混ぜない");
    expect(events.some((event) => event.type === "prompt_pack_ready")).toBe(false);
    expect((await loadSpawnProposalQueue(root)).find((entry) => entry.proposalId === "spawn_old_draft")).toMatchObject({ status: "done" });
  }, 30000);

  it("runs spawn_d554cf through completion without orphaning the draft", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = workspace();
    await prepareRoot(root);
    await appendSpawnProposal(root, proposal("spawn_d554cf", "draft"));

    await clickCreate(root, "spawn_d554cf");
    await runUntilCompleted(root, "spawn_d554cf");

    expect(await readSongState(root, "spawn_d554cf")).toMatchObject({
      title: "安全圏の芝",
      status: "take_selected"
    });
    expect((await loadSpawnProposalQueue(root)).find((entry) => entry.proposalId === "spawn_d554cf")).toMatchObject({ status: "done" });
  }, 30000);

  it("rejects a second create while one draft is building without creating a waiting state", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = workspace();
    await prepareRoot(root);
    await appendSpawnProposal(root, proposal("spawn_first", "building"));
    await appendSpawnProposal(root, proposal("spawn_second", "draft"));
    await writeAutopilotRunState(root, {
      runId: "building-run",
      currentSongId: "spawn_first",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: "2026-06-01T00:00:00.000Z"
    });
    const action = await registerCreate(root, "spawn_second");

    const result = await routeTelegramCallback({
      root,
      client: client(),
      callbackQueryId: "busy",
      data: `cb:${action.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });

    expect(result).toMatchObject({ result: "blocked", reason: "draft_box_building_busy" });
    const proposals = await loadSpawnProposalQueue(root);
    expect(proposals.find((entry) => entry.proposalId === "spawn_first")).toMatchObject({ status: "building" });
    expect(proposals.find((entry) => entry.proposalId === "spawn_second")).toMatchObject({ status: "draft" });
    expect(proposals.some((entry) => String(entry.status) === "accepted_waiting")).toBe(false);
  }, 30000);

  it("does not chain one-shot completion into external publish events", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = workspace();
    await prepareRoot(root);
    await appendSpawnProposal(root, proposal("spawn_private"));

    await clickCreate(root, "spawn_private");
    const events = await runUntilCompleted(root, "spawn_private");

    expect(events.some((event) => event.type === "distribution_change_detected")).toBe(false);
    expect(events.some((event) => event.type === "song_songbook_written")).toBe(false);
    expect(events.some((event) => event.type === "song_publish_skipped")).toBe(false);
  }, 30000);
});
