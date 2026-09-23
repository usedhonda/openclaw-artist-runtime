import { describe, expect, it, vi } from "vitest";
import { TelegramClient } from "../src/services/telegramClient";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}

describe("TelegramClient reply markup and callback methods", () => {
  it("sends inline keyboard reply markup with sendMessage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { message_id: 1, chat: { id: 123 }, text: "ok" }
    }));
    const client = new TelegramClient("token", fetchImpl);

    await client.sendMessage(123, "choose", {
      replyMarkup: { inline_keyboard: [[{ text: "Yes", callback_data: "cb:abc123" }]] }
    });

    expect(fetchImpl.mock.calls[0][0]).toContain("/sendMessage");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({
      chat_id: 123,
      text: "choose",
      reply_markup: { inline_keyboard: [[{ text: "Yes", callback_data: "cb:abc123" }]] }
    });
  });

  it("calls answerCallbackQuery with Telegram body shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: true }));
    const client = new TelegramClient("token", fetchImpl);

    await client.answerCallbackQuery("query-1", { text: "OK", showAlert: true });

    expect(fetchImpl.mock.calls[0][0]).toContain("/answerCallbackQuery");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({
      callback_query_id: "query-1",
      text: "OK",
      show_alert: true
    });
  });

  it("edits message reply markup and text", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 2, chat: { id: 123 }, text: "done" } }));
    const client = new TelegramClient("token", fetchImpl);

    await client.editMessageReplyMarkup(123, 2, { inline_keyboard: [] });
    await client.editMessageText(123, 2, "done", { replyMarkup: { inline_keyboard: [] } });

    expect(fetchImpl.mock.calls[0][0]).toContain("/editMessageReplyMarkup");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({
      chat_id: 123,
      message_id: 2,
      reply_markup: { inline_keyboard: [] }
    });
    expect(fetchImpl.mock.calls[1][0]).toContain("/editMessageText");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string)).toMatchObject({
      chat_id: 123,
      message_id: 2,
      text: "done",
      reply_markup: { inline_keyboard: [] }
    });
  });
});
