import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { updateSongState } from "../src/services/artistState";
import type { TelegramClient } from "../src/services/telegramClient";
import type { CommissionBrief } from "../src/types";

// Plan v10.56 self-recovery: a Telegram user can re-surface an expired/stale
// producer-decision (spawn) button into a fresh proposal notification, without
// developer flags. External-publish actions must NOT be user-re-surfaceable.

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-resurface-"));
}

function clientMock(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 201, chat: { id: 100 } })
  } as unknown as TelegramClient;
}

function brief(songId: string): CommissionBrief {
  return {
    songId,
    title: "テスト曲",
    brief: "テスト概要",
    lyricsTheme: "テーマ",
    mood: "tense",
    tempo: "120 BPM",
    styleNotes: "nu-jazz rap",
    duration: "3:00",
    sourceText: "source",
    createdAt: "2026-05-31T00:00:00.000Z"
  };
}

describe("callback resurface (Plan v10.56)", () => {
  beforeEach(() => {
    getRuntimeEventBus().clearForTest();
  });

  it("re-surfaces an expired spawn-proposal callback via song_spawn_proposed re-emit", async () => {
    const ws = root();
    const client = clientMock();
    const events: RuntimeEvent[] = [];
    const unsub = getRuntimeEventBus().subscribe((e) => events.push(e));

    const entry = await registerCallbackAction(ws, {
      action: "song_spawn_inject",
      proposalId: "spawn_x",
      songId: "spawn_x",
      commissionBrief: brief("spawn_x"),
      chatId: 100,
      messageId: 200,
      userId: 300,
      now: 1000,
      expiresAt: 5000
    });

    const result = await routeTelegramCallback({
      root: ws,
      client,
      callbackQueryId: "q1",
      data: `cb:${entry.callbackId}`,
      fromUserId: 300,
      chatId: 100,
      messageId: 200,
      now: 9000 // now > expiresAt
    });
    unsub();

    expect(result).toMatchObject({ processed: true, result: "updated", reason: "callback_resurfaced" });
    expect(events.some((e) => e.type === "song_spawn_proposed")).toBe(true);
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("q1", { text: expect.stringContaining("再表示") });
  });

  it("does NOT re-surface external-publish callbacks (R10 boundary)", async () => {
    const ws = root();
    const client = clientMock();
    const events: RuntimeEvent[] = [];
    const unsub = getRuntimeEventBus().subscribe((e) => events.push(e));

    const entry = await registerCallbackAction(ws, {
      action: "x_publish_confirm",
      songId: "spawn_x",
      chatId: 100,
      messageId: 200,
      userId: 300,
      now: 1000,
      expiresAt: 5000
    });

    const result = await routeTelegramCallback({
      root: ws,
      client,
      callbackQueryId: "q1",
      data: `cb:${entry.callbackId}`,
      fromUserId: 300,
      chatId: 100,
      messageId: 200,
      now: 9000
    });
    unsub();

    expect(result).toMatchObject({ processed: true, result: "expired", reason: "callback_action_expired" });
    expect(events.some((e) => e.type === "song_spawn_proposed")).toBe(false);
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("q1", { text: "Expired" });
  });

  it("blocks a second re-surface of the same callback (multi-fire guard)", async () => {
    const ws = root();
    const client = clientMock();

    const entry = await registerCallbackAction(ws, {
      action: "song_spawn_inject",
      proposalId: "spawn_x",
      songId: "spawn_x",
      commissionBrief: brief("spawn_x"),
      chatId: 100,
      messageId: 200,
      userId: 300,
      now: 1000,
      expiresAt: 5000
    });

    const ctx = {
      root: ws,
      client,
      callbackQueryId: "q1",
      data: `cb:${entry.callbackId}`,
      fromUserId: 300,
      chatId: 100,
      messageId: 200,
      now: 9000
    };

    const first = await routeTelegramCallback(ctx);
    expect(first).toMatchObject({ result: "updated", reason: "callback_resurfaced" });

    const second = await routeTelegramCallback({ ...ctx, callbackQueryId: "q2" });
    expect(second).toMatchObject({ processed: true, result: "duplicate", reason: "resurface_already_done" });
  });

  it("refuses to re-surface when the song already moved to a terminal state", async () => {
    const ws = root();
    const client = clientMock();
    await updateSongState(ws, "spawn_x", { status: "archived" });

    const entry = await registerCallbackAction(ws, {
      action: "song_spawn_inject",
      proposalId: "spawn_x",
      songId: "spawn_x",
      commissionBrief: brief("spawn_x"),
      chatId: 100,
      messageId: 200,
      userId: 300,
      now: 1000,
      expiresAt: 5000
    });

    const result = await routeTelegramCallback({
      root: ws,
      client,
      callbackQueryId: "q1",
      data: `cb:${entry.callbackId}`,
      fromUserId: 300,
      chatId: 100,
      messageId: 200,
      now: 9000
    });

    expect(result).toMatchObject({ processed: true, result: "expired" });
    expect(result.reason).toContain("resurface_rejected_terminal");
  });
});
