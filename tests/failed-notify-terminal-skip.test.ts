import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { ensureSongState, updateSongState } from "../src/services/artistState.js";
import {
  appendFailedNotification,
  isCriticalNotificationEvent,
  latestFailedNotifyEntry,
  listUnreplayedFailedNotifications,
  terminalReplaySongStatus
} from "../src/services/failedNotifyLedger.js";
import { replayFailedNotificationsOnce } from "../src/services/failedNotifyReplayWorker.js";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus.js";

function takeCompletedEvent(songId: string): Extract<RuntimeEvent, { type: "song_take_completed" }> {
  return {
    type: "song_take_completed",
    songId,
    selectedTakeId: "take-1",
    urls: ["https://suno.com/song/take-1"],
    actor: "manual_notify_retrigger",
    timestamp: 1785000000000
  };
}

function telegramOk(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: { message_id: 7, chat: { id: 123 }, text: "ok" } })
  } as Response;
}

afterEach(() => {
  getRuntimeEventBus().clearForTest();
  vi.unstubAllGlobals();
});

describe("failed-notify replay terminal-song skip", () => {
  it("retires (never re-delivers) a failed notification once its song is terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-terminal-skip-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-018", "Route 145");
    await updateSongState(root, "song-018", { status: "archived" });

    const failed = await appendFailedNotification(root, {
      event: takeCompletedEvent("song-018"),
      chatId: 123,
      error: new Error("fetch failed"),
      attempts: 3
    });
    if (!failed) throw new Error("failed entry not created");

    const fetchImpl = vi.fn().mockResolvedValue(telegramOk());
    await expect(replayFailedNotificationsOnce({ root, token: "token", fetchImpl })).resolves.toMatchObject({
      attempted: 0,
      replayed: 0,
      failed: 0,
      terminalSkipped: 1,
      deliveryIds: [failed.deliveryId]
    });
    // No Telegram call, and the entry is retired so future ticks never re-surface it.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await latestFailedNotifyEntry(root, failed.notifyId)).toMatchObject({
      status: "aged_out",
      replayError: "failed_notify_replay_terminal_song:archived"
    });
    await expect(listUnreplayedFailedNotifications(root)).resolves.toHaveLength(0);

    // A second tick is a no-op: the retired entry is no longer a candidate.
    await expect(replayFailedNotificationsOnce({ root, token: "token", fetchImpl })).resolves.toMatchObject({
      attempted: 0,
      terminalSkipped: 0
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still replays a failed notification while its song is non-terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-nonterminal-replay-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-live", "Live Song");
    await updateSongState(root, "song-live", { status: "take_selected" });

    const failed = await appendFailedNotification(root, {
      event: takeCompletedEvent("song-live"),
      chatId: 123,
      error: new Error("fetch failed"),
      attempts: 1
    });
    if (!failed) throw new Error("failed entry not created");

    const fetchImpl = vi.fn().mockResolvedValue(telegramOk());
    await expect(replayFailedNotificationsOnce({ root, token: "token", fetchImpl })).resolves.toMatchObject({
      attempted: 1,
      replayed: 1,
      terminalSkipped: 0
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(await latestFailedNotifyEntry(root, failed.notifyId)).toMatchObject({ status: "replayed" });
  });

  it("treats a captcha human-assist alert as replay-critical so a boot-race failure survives", () => {
    expect(isCriticalNotificationEvent({
      type: "suno_human_assist_requested",
      songId: "song-live",
      title: "Route 145",
      timeoutMinutes: 60,
      timestamp: 1785000000000
    })).toBe(true);
  });

  it("terminalReplaySongStatus resolves terminal status and ignores active/missing songs", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-terminal-helper-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-arch", "Archived");
    await updateSongState(root, "song-arch", { status: "published" });
    await ensureSongState(root, "song-act", "Active");
    await updateSongState(root, "song-act", { status: "suno_prompt_pack" });

    expect(await terminalReplaySongStatus(root, "song-arch")).toBe("published");
    expect(await terminalReplaySongStatus(root, "song-act")).toBeUndefined();
    expect(await terminalReplaySongStatus(root, "song-missing")).toBeUndefined();
    expect(await terminalReplaySongStatus(root, undefined)).toBeUndefined();
  });
});
