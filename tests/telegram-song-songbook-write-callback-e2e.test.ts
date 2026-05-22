import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState, updateSongState } from "../src/services/artistState";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import { TelegramNotifier } from "../src/services/telegramNotifier";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-song-callback-"));
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

async function prepareWorkspace(status: "take_selected" | "scheduled" = "take_selected"): Promise<string> {
  const root = workspace();
  await ensureArtistWorkspace(root);
  await updateSongState(root, "where-it-played", {
    title: "Where It Played",
    status,
    selectedTakeId: "take-1"
  });
  return root;
}

describe("telegram song completion SONGBOOK callbacks", () => {
  it("attaches SONGBOOK-only buttons and marks the song published from callback", async () => {
    const root = await prepareWorkspace();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({
      token: "token",
      chatId: 123,
      workspaceRoot: root,
      aiReviewProvider: "mock",
      fetchImpl
    });

    await notifier.notify({
      type: "song_take_completed",
      songId: "where-it-played",
      selectedTakeId: "take-1",
      urls: ["https://suno.example/take-1"],
      timestamp: Date.parse("2026-04-29T00:00:00.000Z")
    });

    const actions = await readCallbackActionEntries(root);
    const archive = actions.find((entry) => entry.action === "song_archive");
    const discard = actions.find((entry) => entry.action === "song_discard");
    const write = actions.find((entry) => entry.action === "song_songbook_write");
    const skip = actions.find((entry) => entry.action === "song_skip");
    const xPrepare = actions.find((entry) => entry.action === "x_publish_prepare");
    expect(archive).toMatchObject({ songId: "where-it-played", messageId: 77, userId: 123, selectedTakeId: "take-1" });
    expect(discard).toMatchObject({ songId: "where-it-played", messageId: 77, userId: 123, selectedTakeId: "take-1" });
    expect(write).toMatchObject({ songId: "where-it-played", messageId: 77, userId: 123 });
    expect(skip).toMatchObject({ songId: "where-it-played", messageId: 77, userId: 123 });
    expect(xPrepare).toMatchObject({ songId: "where-it-played", messageId: 77, userId: 123, draftUrl: "https://suno.example/take-1" });
    const markupCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    const markupPayload = JSON.parse(String((markupCall?.[1] as RequestInit).body)) as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } };
    expect(markupPayload.reply_markup.inline_keyboard).toEqual([
      [
        { text: "採用して次の曲へ", callback_data: `cb:${archive?.callbackId}` },
        { text: "破棄して次の曲へ", callback_data: `cb:${discard?.callbackId}` }
      ]
    ]);
    expect(markupPayload.reply_markup.inline_keyboard.every((row) => row.length <= 2)).toBe(true);
    const buttons = markupPayload.reply_markup.inline_keyboard.flat();
    expect(buttons).toEqual([
      { text: "採用して次の曲へ", callback_data: `cb:${archive?.callbackId}` },
      { text: "破棄して次の曲へ", callback_data: `cb:${discard?.callbackId}` }
    ]);
    expect(buttons.map((button) => button.text).join(" ")).not.toMatch(/Instagram|TikTok|IG/i);

    const client = callbackClient();
    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-write",
      data: `cb:${write?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });

    expect(result).toMatchObject({ result: "applied", reason: "applied" });
    expect((await readSongState(root, "where-it-played")).status).toBe("published");
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toContain("| where-it-played | Where It Played | published |");
    expect(client.editMessageText).toHaveBeenCalledWith(123, 77, expect.stringContaining("SONGBOOK 反映済"), { replyMarkup: { inline_keyboard: [] } });

    const duplicate = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-write-again",
      data: `cb:${write?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    expect(duplicate).toMatchObject({ result: "duplicate", reason: "already_applied" });
  });

  it("skips song completion without changing song state", async () => {
    const root = await prepareWorkspace("scheduled");
    const notifier = new TelegramNotifier({
      token: "token",
      chatId: 123,
      workspaceRoot: root,
      aiReviewProvider: "mock",
      fetchImpl: vi.fn()
        .mockResolvedValueOnce(telegramResponse({ message_id: 88, chat: { id: 123 } }))
        .mockResolvedValueOnce(telegramResponse(true))
    });
    await notifier.notify({
      type: "song_take_completed",
      songId: "where-it-played",
      urls: [],
      timestamp: Date.parse("2026-04-29T00:00:00.000Z")
    });
    const skip = (await readCallbackActionEntries(root)).find((entry) => entry.action === "song_skip");
    const client = callbackClient();

    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-skip",
      data: `cb:${skip?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 88
    });

    expect(result).toMatchObject({ result: "discarded", reason: "discarded" });
    expect((await readSongState(root, "where-it-played")).status).toBe("scheduled");
    expect(client.editMessageText).toHaveBeenCalledWith(123, 88, expect.stringContaining("後で確認"), { replyMarkup: { inline_keyboard: [] } });
  });
});
