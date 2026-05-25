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
    process.env.TELEGRAM_BOT_TOKEN = "token";

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
});
