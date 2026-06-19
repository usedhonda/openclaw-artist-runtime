import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendFailedNotification,
  failedNotifyLedgerPath,
  latestFailedNotifyEntry,
  listUnreplayedFailedNotifications
} from "../src/services/failedNotifyLedger";
import { replayFailedNotificationsOnce } from "../src/services/failedNotifyReplayWorker";
import { buildFailedNotifyListResponse, buildFailedNotifyReplayResponse } from "../src/routes";
import { RuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { TelegramNotifier } from "../src/services/telegramNotifier";

function promptPackEvent(songId = "spawn_c6ad5e"): Extract<RuntimeEvent, { type: "prompt_pack_ready" }> {
  return {
    type: "prompt_pack_ready",
    songId,
    title: "みじかいかげ",
    lyricsExcerpt: "短い影だけ残る",
    mood: "tense",
    tempo: "142 BPM",
    styleNotes: "sparse drums",
    timestamp: 1779500000000
  };
}

function degradedLyricsEvent(songId = "spawn_616e01"): Extract<RuntimeEvent, { type: "lyrics_generation_degraded" }> {
  return {
    type: "lyrics_generation_degraded",
    songId,
    reason: "lyrics_generation_degraded: provider fallback response",
    detail: "provider fallback response",
    repairNotes: ["provider fallback response"],
    timestamp: 1779500000000
  };
}

function telegramOk(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: { message_id: 7, chat: { id: 123 }, text: "ok" } })
  } as Response;
}

function timeoutError(): Error {
  return Object.assign(new Error("fetch failed"), {
    cause: { code: "ETIMEDOUT", message: "timeout" }
  });
}

afterEach(() => {
  delete process.env.OPENCLAW_TELEGRAM_RETRY_MAX;
  delete process.env.OPENCLAW_TELEGRAM_RETRY_BASE_MS;
  delete process.env.TELEGRAM_BOT_TOKEN;
  vi.unstubAllGlobals();
});

describe("failed-notify ledger", () => {
  it("records only critical Telegram notification failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-failed-notify-"));
    await appendFailedNotification(root, {
      event: promptPackEvent(),
      chatId: 123,
      error: new Error("fetch failed"),
      attempts: 3,
      now: new Date("2026-05-25T00:00:00.000Z")
    });

    const failed = await listUnreplayedFailedNotifications(root);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      eventType: "prompt_pack_ready",
      songId: "spawn_c6ad5e",
      attempts: 3
    });
  });

  it("TelegramNotifier subscribe appends failed critical delivery after retry exhaustion", async () => {
    process.env.OPENCLAW_TELEGRAM_RETRY_MAX = "1";
    process.env.OPENCLAW_TELEGRAM_RETRY_BASE_MS = "1";
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-notifier-failed-"));
    const bus = new RuntimeEventBus();
    const notifier = new TelegramNotifier({
      token: "token",
      chatId: 123,
      workspaceRoot: root,
      fetchImpl: vi.fn().mockRejectedValue(timeoutError())
    });
    notifier.subscribe(bus);

    bus.emit(promptPackEvent());

    await vi.waitFor(async () => {
      const raw = await readFile(failedNotifyLedgerPath(root), "utf8");
      expect(raw).toContain("prompt_pack_ready");
    });
    const failed = await listUnreplayedFailedNotifications(root);
    expect(failed[0]).toMatchObject({
      eventType: "prompt_pack_ready",
      songId: "spawn_c6ad5e",
      attempts: 1
    });
  });

  it("records failed degraded-lyrics recovery delivery in failed-notify ledger", async () => {
    process.env.OPENCLAW_TELEGRAM_RETRY_MAX = "1";
    process.env.OPENCLAW_TELEGRAM_RETRY_BASE_MS = "1";
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-notifier-failed-degraded-"));
    const bus = new RuntimeEventBus();
    const notifier = new TelegramNotifier({
      token: "token",
      chatId: 123,
      workspaceRoot: root,
      fetchImpl: vi.fn().mockRejectedValue(timeoutError())
    });
    notifier.subscribe(bus);

    bus.emit(degradedLyricsEvent());

    await vi.waitFor(async () => {
      const raw = await readFile(failedNotifyLedgerPath(root), "utf8");
      expect(raw).toContain("lyrics_generation_degraded");
    });
    const failed = await listUnreplayedFailedNotifications(root);
    expect(failed[0]).toMatchObject({
      eventType: "lyrics_generation_degraded",
      songId: "spawn_616e01",
      attempts: 1
    });
  });

  it("lists and replays failed notifications without invoking callback dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-replay-notify-"));
    const failed = await appendFailedNotification(root, {
      event: promptPackEvent(),
      chatId: 123,
      error: new Error("fetch failed"),
      attempts: 3
    });
    if (!failed) throw new Error("failed entry not created");
    const fetchImpl = vi.fn().mockResolvedValue(telegramOk());
    vi.stubGlobal("fetch", fetchImpl);
    process.env["TELEGRAM_BOT_TOKEN"] = "token";

    await expect(buildFailedNotifyListResponse({ config: { artist: { workspaceRoot: root } } })).resolves.toMatchObject({
      count: 1,
      failed: [expect.objectContaining({ notifyId: failed.notifyId })]
    });
    await expect(buildFailedNotifyReplayResponse({ config: { artist: { workspaceRoot: root } } }, failed.notifyId)).resolves.toMatchObject({
      replayed: true,
      notifyId: failed.notifyId,
      reason: "failed_notify_replayed",
      statusCode: 200
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/sendMessage"), expect.any(Object));
    expect(await latestFailedNotifyEntry(root, failed.notifyId)).toMatchObject({ status: "replayed" });
    await expect(buildFailedNotifyReplayResponse({ config: { artist: { workspaceRoot: root } } }, failed.notifyId)).resolves.toMatchObject({
      replayed: false,
      reason: "failed_notify_already_replayed",
      statusCode: 409
    });
  });

  it("replay worker keeps retrying failed delivery until a Telegram ack is recorded", async () => {
    process.env.OPENCLAW_TELEGRAM_RETRY_MAX = "1";
    process.env.OPENCLAW_TELEGRAM_RETRY_BASE_MS = "1";
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-replay-worker-"));
    const failed = await appendFailedNotification(root, {
      event: promptPackEvent(),
      chatId: 123,
      error: new Error("fetch failed"),
      attempts: 3
    });
    if (!failed) throw new Error("failed entry not created");
    const fetchImpl = vi.fn().mockRejectedValueOnce(timeoutError());

    await expect(replayFailedNotificationsOnce({ root, token: "token", fetchImpl })).resolves.toMatchObject({
      attempted: 1,
      replayed: 0,
      failed: 1,
      deliveryIds: [failed.deliveryId]
    });
    expect(await latestFailedNotifyEntry(root, failed.notifyId)).toMatchObject({
      status: "replay_failed",
      attempts: 4
    });
    await expect(listUnreplayedFailedNotifications(root)).resolves.toHaveLength(1);

    fetchImpl.mockResolvedValue(telegramOk());
    await expect(replayFailedNotificationsOnce({ root, token: "token", fetchImpl })).resolves.toMatchObject({
      attempted: 1,
      replayed: 1,
      failed: 0,
      deliveryIds: [failed.deliveryId]
    });
    expect(await latestFailedNotifyEntry(root, failed.notifyId)).toMatchObject({ status: "replayed" });
    await expect(listUnreplayedFailedNotifications(root)).resolves.toHaveLength(0);
  });

  it("replay worker ages out stale critical notifications instead of replaying old producer actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-replay-aged-out-"));
    const failed = await appendFailedNotification(root, {
      event: promptPackEvent(),
      chatId: 123,
      error: new Error("fetch failed"),
      attempts: 3,
      now: new Date(Date.now() - 7 * 60 * 60 * 1000)
    });
    if (!failed) throw new Error("failed entry not created");
    const fetchImpl = vi.fn().mockResolvedValue(telegramOk());

    await expect(replayFailedNotificationsOnce({
      root,
      token: "token",
      fetchImpl,
      maxAgeMs: 6 * 60 * 60 * 1000
    })).resolves.toMatchObject({
      attempted: 0,
      replayed: 0,
      failed: 0,
      agedOut: 1,
      deliveryIds: [failed.deliveryId]
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await latestFailedNotifyEntry(root, failed.notifyId)).toMatchObject({ status: "aged_out" });
    await expect(listUnreplayedFailedNotifications(root)).resolves.toHaveLength(0);
  });

  it("replay worker suppresses duplicate sends for the same deliveryId", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-replay-dedup-"));
    const first = await appendFailedNotification(root, {
      event: promptPackEvent(),
      chatId: 123,
      error: new Error("fetch failed"),
      attempts: 3
    });
    await appendFailedNotification(root, {
      event: promptPackEvent(),
      chatId: 123,
      error: new Error("fetch failed again"),
      attempts: 3
    });
    if (!first) throw new Error("failed entry not created");
    const fetchImpl = vi.fn().mockResolvedValue(telegramOk());

    await expect(replayFailedNotificationsOnce({ root, token: "token", fetchImpl })).resolves.toMatchObject({
      attempted: 1,
      replayed: 1,
      failed: 0,
      deliveryIds: [first.deliveryId]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
