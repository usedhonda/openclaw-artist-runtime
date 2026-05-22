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
import type { TelegramClient } from "../src/services/telegramClient";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-song-review-"));
}

async function prepareSong(): Promise<string> {
  const root = workspace();
  await ensureArtistWorkspace(root);
  await writeSongBrief(root, "review-song", "## Brief\n\nKeep this seed for reuse.");
  await updateSongState(root, "review-song", {
    title: "Review Song",
    status: "take_selected",
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
        message: "この曲を採用しました。次の曲作りへ進みます (autopilot 再開の合図をお待ちしています)。SNS には出していません。"
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
        message: "この曲を破棄しました。次の曲作りへ進みます (autopilot 再開の合図をお待ちしています)。brief は残しています。"
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
    expect(client.editMessageText).toHaveBeenCalledWith(100, 200, "この曲を採用しました。次の曲作りへ進みます (autopilot 再開の合図をお待ちしています)。SNS には出していません。", { replyMarkup: { inline_keyboard: [] } });
    expect(describeCallbackActionEffect("song_archive")).toMatchObject({
      label: "採用して次の曲へ",
      effect: "この曲を採用し、次の曲作りへ進める (autopilot 再開待ち)。SNS には出さない。"
    });
    expect(describeCallbackActionEffect("song_discard")).toMatchObject({
      label: "破棄して次の曲へ",
      effect: "この曲を破棄し、次の曲作りへ進める (autopilot 再開待ち)。brief は reuse のため残す。"
    });
  });
});
