import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState } from "../src/services/artistState";
import { writeAutopilotRunState } from "../src/services/autopilotService";
import { draftBoxProactiveNoticeLedgerPath, emitDraftBoxProactiveNoticeIfNeeded } from "../src/services/draftBoxProactiveNotice";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { appendSpawnProposal } from "../src/services/spawnProposalQueue";
import { formatRuntimeEvent, TelegramNotifier } from "../src/services/telegramNotifier";
import type { AutopilotRunState, SpawnProposal } from "../src/types";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-draft-box-proactive-"));
  await ensureArtistWorkspace(root);
  getRuntimeEventBus().clearForTest();
  return root;
}

function proposal(id: string, title: string): SpawnProposal {
  return {
    proposalId: id,
    createdAt: "2026-06-01T00:00:00.000Z",
    status: "draft",
    title,
    voiceTop: `${title}で行く案。`,
    coreTheme: `${title}の重さ`,
    observationSources: [],
    cascadeTrace: {
      observationSources: [],
      artistVoice: `${title}で行く案。`,
      title,
      lyricsTheme: `${title}の重さ`,
      styleLayer: "dry male vocal, 142 BPM"
    }
  };
}

describe("draft box proactive notices", () => {
  it("notifies once when the artist is idle with draft ideas", async () => {
    const root = await workspace();
    await appendSpawnProposal(root, proposal("spawn_idle", "安全圏の芝"));
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const state: AutopilotRunState = {
      stage: "completed",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      updatedAt: "2026-06-01T00:00:00.000Z"
    };

    expect(await emitDraftBoxProactiveNoticeIfNeeded(root, state)).toBe(true);
    expect(await emitDraftBoxProactiveNoticeIfNeeded(root, state)).toBe(false);
    unsubscribe();

    const notices = events.filter((event): event is Extract<RuntimeEvent, { type: "artist_proactive_notice" }> => event.type === "artist_proactive_notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      trigger: "draft_idle",
      message: "手が空いてる。草稿箱から作る?",
      draftCount: 1
    });
    expect(await readFile(draftBoxProactiveNoticeLedgerPath(root), "utf8")).toContain("draft_idle");
  });

  it("notifies once when Suno is disconnected or timing out", async () => {
    const root = await workspace();
    await ensureSongState(root, "spawn_timeout", "ハンズ前、解散");
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const state: AutopilotRunState = {
      currentSongId: "spawn_timeout",
      stage: "suno_generation",
      paused: false,
      blockedReason: "suno_generate_retry:playwright_live_timeout",
      lastError: "playwright_live_timeout",
      retryCount: 1,
      cycleCount: 2,
      updatedAt: "2026-06-01T00:00:00.000Z"
    };

    expect(await emitDraftBoxProactiveNoticeIfNeeded(root, state)).toBe(true);
    expect(await emitDraftBoxProactiveNoticeIfNeeded(root, state)).toBe(false);
    expect(await emitDraftBoxProactiveNoticeIfNeeded(root, {
      ...state,
      blockedReason: "suno_generate_retry_wait_until_2026-06-01T20:13:26.353Z"
    })).toBe(false);
    unsubscribe();

    const notice = events.find((event): event is Extract<RuntimeEvent, { type: "artist_proactive_notice" }> => event.type === "artist_proactive_notice");
    expect(notice).toMatchObject({
      trigger: "suno_trouble",
      songId: "spawn_timeout"
    });
    expect(notice?.message).toContain("timeout");
  });

  it("formats proactive notices with the same next-action section", async () => {
    const text = await formatRuntimeEvent({
      type: "artist_proactive_notice",
      trigger: "suno_trouble",
      message: "Suno に今つながってない、または timeout で詰まってる。整えて。",
      nextAction: "次: Suno 接続を整える。戻ったら自動で続きから確認する。",
      draftCount: 3,
      buildingCount: 1,
      songId: "spawn_timeout",
      title: "ハンズ前、解散",
      reason: "playwright_live_timeout",
      stateKey: "suno_trouble:spawn_timeout:playwright_live_timeout",
      timestamp: 1
    });

    expect(text).toContain("Suno に今つながってない");
    expect(text).toContain("草稿箱: draft 3件 / building 1件");
    expect(text).toContain("次: Suno 接続を整える");
  });

  it("runs a startup check when Telegram notifier subscribes to an already stuck runtime", async () => {
    const root = await workspace();
    await ensureSongState(root, "spawn_timeout", "ハンズ前、解散");
    await writeAutopilotRunState(root, {
      currentSongId: "spawn_timeout",
      stage: "suno_generation",
      paused: false,
      blockedReason: "suno_generate_retry:playwright_live_timeout",
      lastError: "playwright_live_timeout",
      retryCount: 1,
      cycleCount: 2,
      updatedAt: "2026-06-01T00:00:00.000Z"
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { message_id: 1, chat: { id: 123 } }
    }), { status: 200 }));
    const bus = getRuntimeEventBus();
    const unsubscribe = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl }).subscribe(bus);

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    unsubscribe();

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body)) as { text: string };
    expect(body.text).toContain("Suno に今つながってない");
    expect(body.text).toContain("次: Suno 接続を整える");
  });
});
