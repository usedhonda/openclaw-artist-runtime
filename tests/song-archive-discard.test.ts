import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { describeCallbackActionEffect, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { runSongPublishAction } from "../src/services/songPublishActionRegistry";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import { AutopilotTicker } from "../src/services/autopilotTicker";
import type { TelegramClient } from "../src/services/telegramClient";
import type { SongStatus } from "../src/types";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-song-review-"));
}

async function prepareSong(status: SongStatus = "take_selected"): Promise<string> {
  const root = workspace();
  await ensureArtistWorkspace(root);
  await writeSongBrief(root, "review-song", "## Brief\n\nKeep this seed for reuse.");
  await updateSongState(root, "review-song", {
    title: "Review Song",
    status,
    selectedTakeId: "take-1",
    appendPublicLinks: ["https://suno.example/take-1"],
    reason: "test selected take"
  });
  return root;
}

function clientMock(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 201, chat: { id: 100 } })
  } as unknown as TelegramClient;
}

describe("song archive/discard producer review state machine", () => {
  it("archives a selected take without making it publishable", async () => {
    const root = await prepareSong();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    try {
      const result = await runSongPublishAction("song_archive", {
        root,
        songId: "review-song",
        now: 1000
      });

      expect(result).toMatchObject({
        action: "song_archive",
        status: "applied",
        message: "採用しました。SNS には出していません。"
      });
      expect(result.song).toMatchObject({ status: "archived", selectedTakeId: "take-1" });
      expect(events).toContainEqual(expect.objectContaining({
        type: "song_archived",
        songId: "review-song",
        selectedTakeId: "take-1",
        timestamp: 1000
      }));
      await expect(runSongPublishAction("song_songbook_write", {
        root,
        songId: "review-song",
        now: 2000
      })).rejects.toThrow("song_publish_state_guard:archived");
    } finally {
      unsubscribe();
    }
  });

  it("discards a selected take while preserving the brief for reuse", async () => {
    const root = await prepareSong();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    try {
      const result = await runSongPublishAction("song_discard", {
        root,
        songId: "review-song",
        now: 3000
      });

      expect(result).toMatchObject({
        action: "song_discard",
        status: "discarded",
        message: "破棄しました。brief は残しています。"
      });
      const song = await readSongState(root, "review-song");
      expect(song).toMatchObject({ status: "discarded" });
      expect(song.selectedTakeId).toBeUndefined();
      expect(song.publicLinks).toEqual([]);
      expect(readFileSync(join(root, "songs", "review-song", "brief.md"), "utf8")).toContain("Keep this seed for reuse.");
      expect(events).toContainEqual(expect.objectContaining({
        type: "song_discarded",
        songId: "review-song",
        previousSelectedTakeId: "take-1",
        fromStatus: "take_selected",
        reason: "producer discarded selected take and kept brief for reuse",
        timestamp: 3000
      }));
      await expect(runSongPublishAction("song_songbook_write", {
        root,
        songId: "review-song",
        now: 4000
      })).rejects.toThrow("song_publish_state_guard:discarded");
    } finally {
      unsubscribe();
    }
  });

  it.each(["social_assets", "publishing"] as const)("discards from %s as a post-review rollback without allowing archive", async (status) => {
    const root = await prepareSong(status);
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    try {
      await expect(runSongPublishAction("song_archive", {
        root,
        songId: "review-song",
        now: 5000
      })).rejects.toThrow(`invalid_song_review_transition:${status}`);

      const result = await runSongPublishAction("song_discard", {
        root,
        songId: "review-song",
        now: 6000
      });

      expect(result).toMatchObject({
        action: "song_discard",
        status: "discarded",
        reason: `discard_from_post_review:${status}`
      });
      const song = await readSongState(root, "review-song");
      expect(song).toMatchObject({
        status: "discarded",
        lastReason: `discard_from_post_review:${status}`
      });
      expect(song.selectedTakeId).toBeUndefined();
      expect(song.publicLinks).toEqual([]);
      expect(events).toContainEqual(expect.objectContaining({
        type: "song_discarded",
        songId: "review-song",
        previousSelectedTakeId: "take-1",
        fromStatus: status,
        reason: `discard_from_post_review:${status}`,
        timestamp: 6000
      }));
    } finally {
      unsubscribe();
    }
  });

  it("routes archive callbacks through the same guarded state machine", async () => {
    const root = await prepareSong();
    const client = clientMock();
    const entry = await registerCallbackAction(root, {
      action: "song_archive",
      songId: "review-song",
      chatId: 100,
      messageId: 200,
      userId: 300,
      now: 1000,
      expiresAt: 5000
    });

    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "query-archive",
      data: `cb:${entry.callbackId}`,
      fromUserId: 300,
      chatId: 100,
      messageId: 200,
      now: 2000
    });

    expect(result).toMatchObject({ result: "applied", reason: "applied" });
    expect(await readSongState(root, "review-song")).toMatchObject({ status: "archived" });
    expect(client.editMessageReplyMarkup).toHaveBeenCalledWith(100, 200, { inline_keyboard: [] });
    expect(client.sendMessage).toHaveBeenCalledWith(100, "採用しました。SNS には出していません。", undefined);
    expect(describeCallbackActionEffect("song_archive")).toMatchObject({
      label: "採用",
      effect: "この曲を採用する。SNS には出さない。"
    });
    expect(describeCallbackActionEffect("song_discard")).toMatchObject({
      label: "破棄",
      effect: "この曲を破棄する。brief は reuse のため残す。"
    });
  });

  it("kicks one autopilot cycle after a producer decision instead of waiting the interval", async () => {
    // Without this kick the adopted/discarded lane sits idle until the next ticker
    // interval (default 3h) and the producer waits hours for the next proposal
    // (2026-06-12). Mirrors the v10.66 /resume kick; gates re-apply inside runCycle.
    const root = await prepareSong();
    const client = clientMock();
    const runNow = vi
      .spyOn(AutopilotTicker.prototype, "runNow")
      .mockResolvedValue({
        outcome: "ran",
        state: { stage: "planning", paused: false, retryCount: 0, cycleCount: 1, updatedAt: new Date().toISOString() }
      });
    try {
      const entry = await registerCallbackAction(root, {
        action: "song_archive",
        songId: "review-song",
        chatId: 100,
        messageId: 200,
        userId: 300,
        now: 1000,
        expiresAt: 5000
      });

      const result = await routeTelegramCallback({
        root,
        client,
        callbackQueryId: "query-archive-kick",
        data: `cb:${entry.callbackId}`,
        fromUserId: 300,
        chatId: 100,
        messageId: 200,
        now: 2000
      });

      expect(result).toMatchObject({ result: "applied" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(runNow).toHaveBeenCalledTimes(1);
    } finally {
      runNow.mockRestore();
    }
  });
});
