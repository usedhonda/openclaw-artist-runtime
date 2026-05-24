import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ArtistAutopilotService, readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import type { CommissionBrief } from "../src/types";

const originalSpawn = process.env.OPENCLAW_SONG_SPAWN_ENABLED;

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

async function seedWorkspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-gate-"));
  await ensureArtistWorkspace(root);
  await mkdir(join(root, "observations"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Core obsessions: 社会風刺\nPlaces: 六本木\n", "utf8");
  await writeFile(join(root, "SOUL.md"), [
    "# SOUL.md",
    "## 文体 variation rule",
    "### sentence_endings",
    "- だ。",
    "## Producer (relationship in music-making)",
    "### Producer call",
    "- producer_callname: ゆずるさん",
    "- first_person: 俺"
  ].join("\n"), "utf8");
  await writeFile(join(root, "observations", "news-2026-05-25.md"), [
    "# News Observations 2026-05-25",
    "",
    "- text: \"コピー機の夜景が六本木の若者を照らしている\"",
    "  source: \"fixture news\"",
    "  url: \"https://example.com/news\"",
    "  motifMatch: \"社会風刺/六本木\"",
    "  motifScore: 9"
  ].join("\n"), "utf8");
  return root;
}

function brief(songId = "spawn_gate"): CommissionBrief {
  return {
    songId,
    title: "コピー機の夜景",
    brief: "六本木の光を社会風刺として切る。",
    lyricsTheme: "コピー機の白い光で、街の疲れを見せる。",
    mood: "tense",
    tempo: "142 BPM",
    duration: "2:45",
    styleNotes: "thick bass, restrained hi-hats, sparse arrangement",
    sourceText: "test",
    createdAt: "2026-05-25T00:00:00.000Z"
  };
}

describe("spawn proposal approval gate", () => {
  afterEach(() => {
    if (originalSpawn === undefined) {
      delete process.env.OPENCLAW_SONG_SPAWN_ENABLED;
    } else {
      process.env.OPENCLAW_SONG_SPAWN_ENABLED = originalSpawn;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("suspends at spawn_proposal_ready and does not advance on the next cycle", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T15:00:00.000Z"));
    const root = await seedWorkspace();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const service = new ArtistAutopilotService();

    const state = await service.runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, songSpawn: { enabled: true } }
    });
    const eventCount = events.filter((event) => event.type === "song_spawn_proposed").length;
    const next = await service.runCycle({
      workspaceRoot: root,
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true }, songSpawn: { enabled: true } }
    });
    unsubscribe();

    expect(state).toMatchObject({ stage: "planning", suspendedAt: "spawn_proposal_ready", blockedReason: "spawn_proposal_ready" });
    expect(next).toMatchObject({ stage: "planning", suspendedAt: "spawn_proposal_ready", blockedReason: "spawn_proposal_ready" });
    expect(events.filter((event) => event.type === "song_spawn_proposed")).toHaveLength(eventCount);
    expect(eventCount).toBe(1);
  });

  it("clears spawn_proposal_ready only when the producer presses the GO callback", async () => {
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = await seedWorkspace();
    await writeAutopilotRunState(root, {
      runId: "spawn-gate",
      currentSongId: "spawn_gate",
      stage: "planning",
      paused: false,
      suspendedAt: "spawn_proposal_ready",
      blockedReason: "spawn_proposal_ready",
      retryCount: 0,
      cycleCount: 0,
      updatedAt: new Date().toISOString()
    });
    const entry = await registerCallbackAction(root, {
      action: "song_spawn_inject",
      songId: "spawn_gate",
      commissionBrief: brief(),
      chatId: 123,
      messageId: 77,
      userId: 123
    });

    const result = await routeTelegramCallback({
      root,
      client: client(),
      callbackQueryId: "spawn-gate-go",
      data: `cb:${entry.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    const state = await readAutopilotRunState(root);

    expect(result).toMatchObject({ result: "applied", reason: "song_spawn_injected" });
    expect(state).toMatchObject({ currentSongId: "spawn_gate", stage: "planning", suspendedAt: null });
  });
});
