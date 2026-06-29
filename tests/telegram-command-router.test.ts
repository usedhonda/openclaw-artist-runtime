import { mkdir } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { classifyTelegramFreeText, readTelegramInbox, routeTelegramCommand } from "../src/services/telegramCommandRouter";
import * as autopilotTicker from "../src/services/autopilotTicker";
import { appendFailedNotification } from "../src/services/failedNotifyLedger";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import type { CommissionBrief } from "../src/types";

const baseInput = {
  fromUserId: 123,
  chatId: 456
};

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-telegram-router-"));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("telegram command router", () => {
  it("routes /help to the command list", async () => {
    const result = await routeTelegramCommand({ ...baseInput, text: "/help" });

    expect(result.kind).toBe("help");
    expect(result.responseText).toContain("/status");
    expect(result.responseText).toContain("/pause");
    expect(result.responseText).toContain("/review");
    expect(result.shouldStoreFreeText).toBe(false);
  });

  it("routes /replay to resend failed Telegram notifications (Plan v10.56 Phase 3)", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    const brief: CommissionBrief = {
      songId: "spawn_x",
      title: "t",
      brief: "b",
      lyricsTheme: "lt",
      mood: "m",
      tempo: "120 BPM",
      styleNotes: "s",
      duration: "3:00",
      sourceText: "src",
      createdAt: "2026-05-31T00:00:00.000Z"
    };
    await appendFailedNotification(root, {
      event: { type: "song_spawn_proposed", brief, reason: "r", candidateSongId: "spawn_x", timestamp: 1 },
      chatId: 456,
      error: new Error("ENETUNREACH")
    });

    const events: RuntimeEvent[] = [];
    const bus = getRuntimeEventBus();
    bus.clearForTest();
    const unsub = bus.subscribe((e) => events.push(e));
    const result = await routeTelegramCommand({ ...baseInput, text: "/replay", workspaceRoot: root });
    unsub();

    expect(result.kind).toBe("replay");
    expect(result.responseText).toContain("再送");
    expect(events.some((e) => e.type === "song_spawn_proposed")).toBe(true);
  });

  it("routes /replay to a no-op message when nothing failed to deliver", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    const result = await routeTelegramCommand({ ...baseInput, text: "/replay", workspaceRoot: root });
    expect(result.kind).toBe("replay");
    expect(result.responseText).toContain("再送が必要な通知はありません");
  });

  it("routes /status to formatted autopilot status", async () => {
    const result = await routeTelegramCommand({
      ...baseInput,
      text: "/status",
      autopilotStatus: {
        enabled: true,
        dryRun: true,
        stage: "planning",
        nextAction: "decide_next_song",
        currentSongId: "song-001"
      }
    });

    expect(result.kind).toBe("status");
    expect(result.responseText).toContain("Autopilot: enabled (dry-run)");
    expect(result.responseText).toContain("Stage: planning");
    expect(result.shouldStoreFreeText).toBe(false);
  });

  it("returns latest decision button metadata for /status", async () => {
    const root = makeRoot();
    await ensureSongState(root, "song-ready", "Ready Song");
    await updateSongState(root, "song-ready", {
      status: "take_selected",
      selectedTakeId: "take-ready",
      replacePublicLinks: ["https://suno.com/song/take-ready"]
    });
    await registerCallbackAction(root, {
      action: "song_archive",
      songId: "song-ready",
      selectedTakeId: "take-ready",
      chatId: 456,
      messageId: 77,
      userId: 123
    });
    await registerCallbackAction(root, {
      action: "song_discard",
      songId: "song-ready",
      selectedTakeId: "take-ready",
      chatId: 456,
      messageId: 77,
      userId: 123
    });

    const result = await routeTelegramCommand({ ...baseInput, text: "/status", workspaceRoot: root });

    expect(result.kind).toBe("status");
    expect(result.statusDecisionButtons).toEqual({
      songId: "song-ready",
      selectedTakeId: "take-ready",
      actions: ["song_archive", "song_discard"]
    });
  });

  it("lists recent songs", async () => {
    const root = makeRoot();
    await ensureSongState(root, "song-001", "Ash Road");
    await ensureSongState(root, "song-002", "Cold Relay");

    const result = await routeTelegramCommand({ ...baseInput, text: "/songs", workspaceRoot: root, dashboardBaseUrl: "http://127.0.0.1:8787" });

    expect(result.kind).toBe("songs");
    expect(result.responseText).toContain("song-001");
    expect(result.responseText).toContain("Cold Relay");
    expect(result.responseText).toContain("path: songs/song-001/");
    expect(result.responseText).toContain("http://127.0.0.1:8787/plugins/artist-runtime#song=song-001");
  });

  it("routes /timeline to recent lifecycle rows with dashboard links", async () => {
    const root = makeRoot();
    await ensureSongState(root, "song-001", "Ash Road");
    await updateSongState(root, "song-001", { status: "suno_running", reason: "test" });
    await ensureSongState(root, "song-002", "Cold Relay");
    await updateSongState(root, "song-002", { status: "published", reason: "test" });

    const result = await routeTelegramCommand({ ...baseInput, text: "/timeline", workspaceRoot: root, dashboardBaseUrl: "http://127.0.0.1:8787" });

    expect(result.kind).toBe("timeline");
    expect(result.responseText).toContain("🎬 Timeline (recent 10 songs)");
    expect(result.responseText).toContain("▶ song-001 | suno_generation | \"Ash Road\"");
    expect(result.responseText).toContain("  song-002 | completed | \"Cold Relay\"");
    expect(result.responseText).toContain("path: songs/song-001/");
    expect(result.responseText).toContain("http://127.0.0.1:8787/plugins/artist-runtime#song=song-001");
  });

  it("shows a song detail summary", async () => {
    const root = makeRoot();
    await writeSongBrief(root, "song-001", "# Brief\n\nA cold wire hymn.");
    await updateSongState(root, "song-001", {
      status: "take_selected",
      selectedTakeId: "take-a",
      reason: "test",
      lastImportOutcome: {
        runId: "run-1",
        urlCount: 1,
        pathCount: 1,
        paths: [join(root, "runtime", "suno", "run-1", "take-a.mp3")],
        at: new Date().toISOString()
      }
    });

    const result = await routeTelegramCommand({ ...baseInput, text: "/song song-001", workspaceRoot: root, dashboardBaseUrl: "http://127.0.0.1:8787" });

    expect(result.kind).toBe("song");
    expect(result.responseText).toContain("take-a");
    expect(result.responseText).toContain("Imported assets: 1");
    expect(result.responseText).toContain("A cold wire hymn");
    expect(result.responseText).toContain("brief path: songs/song-001/brief.md");
    expect(result.responseText).toContain("lyrics path: songs/song-001/LYRICS.md");
    expect(result.responseText).toContain("http://127.0.0.1:8787/plugins/artist-runtime#song=song-001");
  });

  it("queues /regen as a dry-run inbox request", async () => {
    const root = makeRoot();
    const result = await routeTelegramCommand({ ...baseInput, text: "/regen song-001", workspaceRoot: root });
    const inbox = await readTelegramInbox(root);

    expect(result.kind).toBe("regen");
    expect(result.responseText).toContain("No Suno create was started");
    expect(inbox[0]).toMatchObject({ type: "regen_requested", songId: "song-001" });
  });

  it("routes setup to the conversational artist without writing persona files", async () => {
    const root = makeRoot();
    const result = await routeTelegramCommand({ ...baseInput, text: "/setup", workspaceRoot: root });

    expect(result.kind).toBe("setup");
    expect(result.responseText).not.toContain("I heard this:");
    expect(result.responseText.length).toBeGreaterThan(0);
    expect(result.shouldStoreFreeText).toBe(true);
  });

  it("does not revive the legacy setup wizard when the persona proposer flag is off", async () => {
    vi.stubEnv("OPENCLAW_PERSONA_PROPOSER", "off");
    const root = makeRoot();
    const result = await routeTelegramCommand({ ...baseInput, text: "/setup", workspaceRoot: root });

    expect(result.responseText).not.toContain("I heard this:");
    expect(result.responseText.length).toBeGreaterThan(0);
    expect(result.shouldStoreFreeText).toBe(true);
  });

  it("pauses and resumes autopilot through the control service", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });

    const paused = await routeTelegramCommand({ ...baseInput, text: "/pause", workspaceRoot: root });
    const pausedState = await readAutopilotRunState(root);
    const resumed = await routeTelegramCommand({ ...baseInput, text: "/resume", workspaceRoot: root });
    const resumedState = await readAutopilotRunState(root);

    expect(paused.kind).toBe("pause");
    expect(pausedState.paused).toBe(true);
    expect(pausedState.pausedReason).toBe("telegram:123");
    expect(resumed.kind).toBe("resume");
    expect(resumedState.paused).toBe(false);
  });

  it("kicks an immediate cycle from /resume to continue a mid-pipeline song (Plan v10.66)", async () => {
    const root = makeRoot();
    await ensureSongState(root, "spawn-test", "Resume Continue");
    await updateSongState(root, "spawn-test", { status: "suno_prompt_pack" });
    await writeAutopilotRunState(root, {
      runId: "auto-resume",
      currentSongId: "spawn-test",
      stage: "paused",
      paused: true,
      blockedReason: "suno_generate_failed:suno_worker_not_connected",
      retryCount: 3,
      cycleCount: 4,
      updatedAt: new Date(1000).toISOString(),
      lastRunAt: new Date(1000).toISOString()
    });
    const runNow = vi.fn().mockResolvedValue({ outcome: "ran", state: {} });
    vi.spyOn(autopilotTicker, "getAutopilotTicker").mockReturnValue(
      { runNow } as unknown as ReturnType<typeof autopilotTicker.getAutopilotTicker>
    );

    const result = await routeTelegramCommand({ ...baseInput, text: "/resume", workspaceRoot: root });
    const state = await readAutopilotRunState(root);

    expect(result.kind).toBe("resume");
    expect(runNow).toHaveBeenCalledTimes(1);
    expect(result.responseText).toContain("spawn-test");
    expect(state.paused).toBe(false);
    expect(state.blockedReason).toBeUndefined();
    // manual resume grants a fresh Suno retry budget so the next tick re-attempts
    expect(state.retryCount).toBe(0);
  });

  it("does not kick a cycle from /resume when a producer GO gate is pending (Plan v10.66)", async () => {
    const root = makeRoot();
    await ensureSongState(root, "spawn-gated", "Awaiting GO");
    await updateSongState(root, "spawn-gated", { status: "idea" });
    await writeAutopilotRunState(root, {
      runId: "auto-gate",
      currentSongId: "spawn-gated",
      stage: "paused",
      paused: true,
      suspendedAt: "spawn_proposal_ready",
      retryCount: 0,
      cycleCount: 1,
      updatedAt: new Date(1000).toISOString(),
      lastRunAt: new Date(1000).toISOString()
    });
    const runNow = vi.fn().mockResolvedValue({ outcome: "ran", state: {} });
    vi.spyOn(autopilotTicker, "getAutopilotTicker").mockReturnValue(
      { runNow } as unknown as ReturnType<typeof autopilotTicker.getAutopilotTicker>
    );

    const result = await routeTelegramCommand({ ...baseInput, text: "/resume", workspaceRoot: root });
    const state = await readAutopilotRunState(root);

    expect(result.kind).toBe("resume");
    expect(runNow).not.toHaveBeenCalled();
    // GO-gate suspension survives resume and waits for the operator's GO button
    expect(state.suspendedAt).toBe("spawn_proposal_ready");
  });

  it("re-surfaces degraded lyrics from /resume without resuming the paused autopilot", async () => {
    const root = makeRoot();
    await ensureSongState(root, "song-lyrics", "Lyrics Stuck");
    await updateSongState(root, "song-lyrics", {
      status: "brief",
      degradedLyrics: true,
      reason: "lyrics_generation_degraded: provider fallback response"
    });
    await writeAutopilotRunState(root, {
      runId: "degraded",
      currentSongId: "song-lyrics",
      stage: "paused",
      paused: true,
      blockedReason: "lyrics_generation_degraded: provider fallback response",
      retryCount: 1,
      cycleCount: 1,
      updatedAt: new Date(1000).toISOString(),
      lastRunAt: new Date(1000).toISOString()
    });
    const events: RuntimeEvent[] = [];
    const bus = getRuntimeEventBus();
    bus.clearForTest();
    const unsubscribe = bus.subscribe((event) => events.push(event));

    const result = await routeTelegramCommand({ ...baseInput, text: "/resume", workspaceRoot: root });
    const state = await readAutopilotRunState(root);
    unsubscribe();

    expect(result.kind).toBe("resume");
    expect(result.responseText).toContain("歌詞生成に失敗");
    expect(result.responseText).toContain("破棄");
    expect(result.responseText).toContain("歌詞を作り直す");
    expect(state).toMatchObject({
      currentSongId: "song-lyrics",
      stage: "paused",
      paused: true,
      blockedReason: "lyrics_generation_degraded: provider fallback response"
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "lyrics_generation_degraded", songId: "song-lyrics" });
  });

  it("returns a safe response for unknown commands", async () => {
    const result = await routeTelegramCommand({ ...baseInput, text: "/wat" });

    expect(result.kind).toBe("unknown");
    expect(result.responseText).toContain("Unknown command");
    expect(result.shouldStoreFreeText).toBe(false);
  });

  it("stages free-text for the local inbox path", async () => {
    const result = await routeTelegramCommand({ ...baseInput, text: "please make the next hook colder" });

    expect(result.kind).toBe("free_text");
    expect(result.responseText).toContain("local artist inbox");
    expect(result.shouldStoreFreeText).toBe(true);
  });

  it("classifies free-text command suggestions without forwarding to CC or Cdx", () => {
    expect(classifyTelegramFreeText("please pause")).toBe("pause");
    expect(classifyTelegramFreeText("resume the artist")).toBe("resume");
    expect(classifyTelegramFreeText("status?")).toBe("status");
    expect(classifyTelegramFreeText("make the hook colder")).toBe("artist_inbox");
  });
});
