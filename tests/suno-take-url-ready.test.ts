import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState, updateSongState } from "../src/services/artistState";
import { ArtistAutopilotService, writeAutopilotRunState } from "../src/services/autopilotService";
import { readCallbackActionEntries, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { composeProducerStatus } from "../src/services/producerStatusComposer";
import { DEFAULT_ADOPTION_DOWNLOAD_DELAY_MS, readAdoptionDownloadJobEntries, rearmQueuedAdoptionDownloadJobs } from "../src/services/sunoAdoptionDownloadJob";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { readLatestSunoRun } from "../src/services/sunoRuns";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import { formatRuntimeEvent, TelegramNotifier } from "../src/services/telegramNotifier";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { buildStatusResponse } from "../src/routes";

const { connectorStatusMock, connectorCreateMock, connectorImportMock } = vi.hoisted(() => ({
  connectorStatusMock: vi.fn(),
  connectorCreateMock: vi.fn(),
  connectorImportMock: vi.fn()
}));

vi.mock("../src/connectors/suno/browserWorkerConnector.js", () => ({
  BrowserWorkerSunoConnector: vi.fn().mockImplementation(() => ({
    status: connectorStatusMock,
    create: connectorCreateMock,
    importResults: connectorImportMock
  }))
}));

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-suno-url-ready-"));
}

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function callbackClient(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 99, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

async function seedPromptPack(root: string, songId = "song-url"): Promise<void> {
  await ensureArtistWorkspace(root);
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId,
    songTitle: "URL Gate",
    artistReason: "capture Suno URL before audio import",
    lyricsText: "[Verse 1]\nしずかなビルに信号が残る",
    moodHint: "dry civic pulse",
    bpm: 142
  });
  await writeAutopilotRunState(root, {
    runId: songId,
    currentSongId: songId,
    stage: "suno_generation",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date(0).toISOString(),
    lastSuccessfulStage: "prompt_pack"
  });
}

async function writeAcceptedRun(root: string, songId = "song-url"): Promise<void> {
  await mkdir(join(root, "songs", songId, "suno"), { recursive: true });
  await writeFile(join(root, "songs", songId, "suno", "runs.jsonl"), `${JSON.stringify({
    runId: "run-ready",
    songId,
    createdAt: "2026-06-16T00:00:00.000Z",
    mode: "background_browser_worker",
    authorityDecision: { allowed: true, reason: "allowed", policyDecision: "create" },
    status: "accepted",
    dryRun: false,
    urls: ["https://suno.com/song/take-ready"]
  })}\n`, "utf8");
}

describe("Suno take URL ready flow", () => {
  beforeEach(() => {
    connectorStatusMock.mockReset();
    connectorCreateMock.mockReset();
    connectorImportMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("emits suno_take_url_ready and releases the lane without waiting for import", async () => {
    const root = workspace();
    await seedPromptPack(root);
    connectorStatusMock.mockResolvedValue({ state: "connected" });
    connectorCreateMock.mockResolvedValue({
      accepted: true,
      runId: "run-ready",
      reason: "submitted_via_create_card",
      urls: ["https://suno.com/song/take-ready"]
    });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: false },
        music: { suno: { driver: "playwright", submitMode: "live", authority: "auto_create_and_select_take" } },
        telegram: { enabled: false }
      }
    });

    unsubscribe();
    const song = await readSongState(root, "song-url");
    const run = await readLatestSunoRun(root, "song-url");
    expect(connectorCreateMock).toHaveBeenCalledTimes(1);
    expect(connectorImportMock).not.toHaveBeenCalled();
    expect(run).toMatchObject({ status: "accepted", urls: ["https://suno.com/song/take-ready"] });
    expect(song).toMatchObject({
      status: "suno_take_url_ready",
      selectedTakeId: "take-ready",
      publicLinks: ["https://suno.com/song/take-ready"]
    });
    expect(state).toMatchObject({
      stage: "idle",
      currentSongId: undefined,
      paused: false,
      blockedReason: undefined,
      lastSuccessfulStage: "suno_generation"
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "suno_take_url_ready",
      songId: "song-url",
      runId: "run-ready",
      urls: ["https://suno.com/song/take-ready"]
    }));
  });

  it("recovers a stale generation lane when an accepted Suno run already has URLs", async () => {
    const root = workspace();
    await seedPromptPack(root);
    await updateSongState(root, "song-url", { status: "suno_prompt_pack", reason: "stale prompt pack state" });
    await writeAcceptedRun(root);
    connectorStatusMock.mockResolvedValue({ state: "generating", currentRunId: "run-ready" });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: false },
        music: { suno: { driver: "playwright", submitMode: "live", authority: "auto_create_and_select_take" } },
        telegram: { enabled: false }
      }
    });

    unsubscribe();
    expect(connectorCreateMock).not.toHaveBeenCalled();
    expect(connectorImportMock).not.toHaveBeenCalled();
    expect(await readSongState(root, "song-url")).toMatchObject({
      status: "suno_take_url_ready",
      selectedTakeId: "take-ready",
      publicLinks: ["https://suno.com/song/take-ready"]
    });
    expect(state).toMatchObject({
      stage: "idle",
      currentSongId: undefined,
      paused: false,
      blockedReason: undefined,
      lastSuccessfulStage: "suno_generation"
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "suno_take_url_ready",
      songId: "song-url",
      runId: "run-ready"
    }));
  });

  it("formats and sends the URL-ready Telegram notification with adoption buttons", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await expect(formatRuntimeEvent({
      type: "suno_take_url_ready",
      songId: "song-url",
      runId: "run-ready",
      selectedTakeId: "take-ready",
      urls: ["https://suno.com/song/take-ready"],
      timestamp: 1
    })).resolves.toContain("生成中、じき完成");

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });

    await notifier.notify({
      type: "suno_take_url_ready",
      songId: "song-url",
      runId: "run-ready",
      selectedTakeId: "take-ready",
      urls: ["https://suno.com/song/take-ready"],
      timestamp: 1
    });

    const sendPayload = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)) as { text: string };
    expect(sendPayload.text).toContain("生成中、じき完成");
    expect(sendPayload.text).toContain("https://suno.com/song/take-ready");
    expect(sendPayload.text).toContain("採用して音源取得");
    expect(sendPayload.text).toContain("音源ファイル取得を予約する");
    const markupPayload = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body)) as { reply_markup: { inline_keyboard: Array<Array<{ text: string }>> } };
    expect(markupPayload.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["採用して音源取得", "破棄"]);
  });

  it("queues one adoption download job and sends URL-valid notice when the delayed import fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "song-url", {
      title: "URL Gate",
      status: "suno_take_url_ready",
      selectedTakeId: "take-ready",
      appendPublicLinks: ["https://suno.com/song/take-ready"]
    });
    await writeAcceptedRun(root);
    connectorImportMock.mockResolvedValue({
      runId: "run-ready",
      urls: [],
      paths: [],
      reason: "audio asset not found"
    });
    const archive = await registerCallbackAction(root, {
      action: "song_archive",
      songId: "song-url",
      selectedTakeId: "take-ready",
      chatId: 123,
      messageId: 77,
      userId: 123,
      now: Date.parse("2026-06-16T00:00:00.000Z")
    });
    const client = callbackClient();

    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "archive-url",
      data: `cb:${archive.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77,
      now: Date.parse("2026-06-16T00:00:00.000Z")
    });

    expect(result).toMatchObject({ result: "applied" });
    const immediateReply = (client.sendMessage as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(String(immediateReply)).toContain("音源ファイル取得を予約しました");
    expect(connectorImportMock).not.toHaveBeenCalled();
    expect(await readAdoptionDownloadJobEntries(root)).toEqual([
      expect.objectContaining({ status: "queued", songId: "song-url" })
    ]);

    await vi.advanceTimersByTimeAsync(DEFAULT_ADOPTION_DOWNLOAD_DELAY_MS);
    await vi.waitFor(() => expect(connectorImportMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => {
      const jobs = await readAdoptionDownloadJobEntries(root);
      expect(jobs.at(-1)).toMatchObject({ status: "failed", reason: "audio asset not found" });
    });
    const sendMessage = client.sendMessage as unknown as ReturnType<typeof vi.fn>;
    expect(sendMessage.mock.calls.some((call) => String(call[1]).includes("音源ファイルは取れなかった。Suno URLは有効"))).toBe(true);
    expect(String(sendMessage.mock.calls.at(-1)?.[1])).toContain("https://suno.com/song/take-ready");
  });

  it("resurfaces fresh URL-ready buttons when an old adoption button expired", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "song-url", {
      title: "URL Gate",
      status: "suno_take_url_ready",
      selectedTakeId: "take-ready",
      appendPublicLinks: ["https://suno.com/song/take-ready"]
    });
    await writeAcceptedRun(root);
    const expired = await registerCallbackAction(root, {
      action: "song_archive",
      songId: "song-url",
      selectedTakeId: "take-ready",
      chatId: 123,
      messageId: 77,
      userId: 123,
      now: Date.parse("2026-06-16T00:00:00.000Z"),
      expiresAt: Date.parse("2026-06-16T00:01:00.000Z")
    });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const client = callbackClient();

    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "archive-url-expired",
      data: `cb:${expired.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77,
      now: Date.parse("2026-06-16T00:02:00.000Z")
    });

    unsubscribe();
    expect(result).toMatchObject({ result: "updated", reason: "callback_resurfaced" });
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("archive-url-expired", {
      text: "Suno URL 採用待ちを再表示しました。届いた通知から選んでください。"
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "suno_take_url_ready",
      songId: "song-url",
      runId: "run-ready",
      urls: ["https://suno.com/song/take-ready"],
      selectedTakeId: "take-ready"
    }));
    expect((await readCallbackActionEntries(root)).find((entry) => entry.callbackId === expired.callbackId && entry.status === "updated")).toBeTruthy();
  });

  it("preserves archived status after a successful adoption download import and does not re-pick the song", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "song-url", {
      title: "URL Gate",
      status: "suno_take_url_ready",
      selectedTakeId: "take-ready",
      appendPublicLinks: ["https://suno.com/song/take-ready"]
    });
    await writeAcceptedRun(root);
    connectorImportMock.mockResolvedValue({
      runId: "run-ready",
      urls: ["https://suno.com/song/take-ready"],
      paths: ["songs/song-url/suno/take-ready.mp3"],
      selectedTakeId: "take-ready"
    });
    const archive = await registerCallbackAction(root, {
      action: "song_archive",
      songId: "song-url",
      selectedTakeId: "take-ready",
      chatId: 123,
      messageId: 77,
      userId: 123,
      now: Date.parse("2026-06-16T00:00:00.000Z")
    });
    await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "archive-url",
      data: `cb:${archive.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77,
      now: Date.parse("2026-06-16T00:00:00.000Z")
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_ADOPTION_DOWNLOAD_DELAY_MS);
    await vi.waitFor(() => expect(connectorImportMock).toHaveBeenCalledTimes(1));
    const song = await readSongState(root, "song-url");
    expect(song).toMatchObject({
      status: "archived",
      selectedTakeId: "take-ready",
      lastImportOutcome: expect.objectContaining({ runId: "run-ready", pathCount: 1 })
    });
    const state = await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: {
        artist: { workspaceRoot: root },
        autopilot: { enabled: true, dryRun: false },
        music: { suno: { driver: "playwright", submitMode: "live", authority: "auto_create_and_select_take" } },
        telegram: { enabled: false },
        songSpawn: { enabled: false }
      }
    });
    expect(state.currentSongId).not.toBe("song-url");
  });

  it("re-arms queued adoption download jobs after a restart-equivalent timer loss", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "song-url", {
      title: "URL Gate",
      status: "suno_take_url_ready",
      selectedTakeId: "take-ready",
      appendPublicLinks: ["https://suno.com/song/take-ready"]
    });
    await writeAcceptedRun(root);
    connectorImportMock.mockResolvedValue({
      runId: "run-ready",
      urls: ["https://suno.com/song/take-ready"],
      paths: ["songs/song-url/suno/take-ready.mp3"],
      selectedTakeId: "take-ready"
    });
    const queued = await registerCallbackAction(root, {
      action: "song_archive",
      songId: "song-url",
      selectedTakeId: "take-ready",
      chatId: 123,
      messageId: 77,
      userId: 123,
      now: Date.parse("2026-06-16T00:00:00.000Z")
    });
    await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "archive-url",
      data: `cb:${queued.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77,
      now: Date.parse("2026-06-16T00:00:00.000Z")
    });
    vi.clearAllTimers();
    vi.setSystemTime(new Date("2026-06-16T00:11:00.000Z"));

    const result = await rearmQueuedAdoptionDownloadJobs({ root, now: Date.parse("2026-06-16T00:11:00.000Z") });

    expect(result).toMatchObject({ queued: 1, runNow: 1 });
    await vi.waitFor(() => expect(connectorImportMock).toHaveBeenCalledTimes(1));
    expect((await readAdoptionDownloadJobEntries(root)).at(-1)).toMatchObject({ status: "imported" });
  });

  it("schedules adoption downloads only for URL-ready archive callbacks and resolves sibling review callbacks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "song-url", {
      title: "URL Gate",
      status: "take_selected",
      selectedTakeId: "take-ready",
      appendPublicLinks: ["https://suno.com/song/take-ready"]
    });
    await writeAcceptedRun(root);
    const archive = await registerCallbackAction(root, {
      action: "song_archive",
      songId: "song-url",
      selectedTakeId: "take-ready",
      chatId: 123,
      messageId: 77,
      userId: 123
    });
    const discard = await registerCallbackAction(root, {
      action: "song_discard",
      songId: "song-url",
      selectedTakeId: "take-ready",
      chatId: 123,
      messageId: 77,
      userId: 123
    });

    await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "archive-take-selected",
      data: `cb:${archive.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });

    await expect(readFile(join(root, "runtime", "suno-download-jobs.jsonl"), "utf8")).rejects.toThrow();
    const entries = await readCallbackActionEntries(root);
    expect(entries.find((entry) => entry.callbackId === archive.callbackId && entry.status === "applied")).toBeTruthy();
    expect(entries.find((entry) => entry.callbackId === discard.callbackId && entry.status === "discarded")).toBeTruthy();
  });

  it("surfaces URL-ready adoption waits in /status composition and StatusResponse", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    connectorStatusMock.mockResolvedValue({ state: "connected" });
    await updateSongState(root, "song-url", {
      title: "URL Gate",
      status: "suno_take_url_ready",
      selectedTakeId: "take-ready",
      appendPublicLinks: ["https://suno.com/song/take-ready"]
    });

    await expect(composeProducerStatus(root)).resolves.toContain("Suno URL 採用待ち");
    const status = await buildStatusResponse({ artist: { workspaceRoot: root } });
    expect(status.awaitingSunoTakeUrlReady).toMatchObject({
      count: 1,
      recent: [expect.objectContaining({ songId: "song-url", urls: ["https://suno.com/song/take-ready"] })]
    });
  });

  it("formats successful adoption download imports in producer-facing Japanese", async () => {
    await expect(formatRuntimeEvent({
      type: "suno_adoption_download_imported",
      songId: "song-url",
      runId: "run-ready",
      selectedTakeId: "take-ready",
      urls: ["https://suno.com/song/take-ready"],
      paths: ["songs/song-url/suno/take-ready.mp3"],
      timestamp: 1
    })).resolves.toContain("音源ファイルも取れた");
  });

  it("does not schedule an adoption download when the producer discards the URL-ready song", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:00.000Z"));
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "song-url", {
      title: "URL Gate",
      status: "suno_take_url_ready",
      selectedTakeId: "take-ready",
      appendPublicLinks: ["https://suno.com/song/take-ready"]
    });
    await writeAcceptedRun(root);
    const discard = await registerCallbackAction(root, {
      action: "song_discard",
      songId: "song-url",
      selectedTakeId: "take-ready",
      chatId: 123,
      messageId: 77,
      userId: 123
    });

    await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "discard-url",
      data: `cb:${discard.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    await expect(readFile(join(root, "runtime", "suno-download-jobs.jsonl"), "utf8")).rejects.toThrow();
    expect(connectorImportMock).not.toHaveBeenCalled();
  });
});
