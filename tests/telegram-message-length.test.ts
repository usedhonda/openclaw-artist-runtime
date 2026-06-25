import { describe, expect, it, vi } from "vitest";
import { TelegramClient } from "../src/services/telegramClient";
import { TELEGRAM_MESSAGE_SAFE_LIMIT } from "../src/services/telegramFormatting";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}

describe("telegram message length guard", () => {
  it("splits plain text longer than Telegram's message limit into safe chunks", async () => {
    const fetchImpl = vi.fn((_input: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({
        ok: true,
        result: { message_id: fetchImpl.mock.calls.length, chat: { id: 123 }, text: "ok" }
      }))
    );
    const client = new TelegramClient("token", fetchImpl);
    const longText = `${"a".repeat(4200)}\n\n${"b".repeat(4200)}`;

    const result = await client.sendMessage(123, longText);

    expect(result.message_id).toBe(fetchImpl.mock.calls.length);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    for (const call of fetchImpl.mock.calls) {
      const body = JSON.parse(String((call[1] as RequestInit).body)) as { text: string };
      expect(Array.from(body.text).length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_SAFE_LIMIT);
    }
  });

  it("keeps reply markup on the last split chunk", async () => {
    const fetchImpl = vi.fn((_input: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({
        ok: true,
        result: { message_id: fetchImpl.mock.calls.length, chat: { id: 123 }, text: "ok" }
      }))
    );
    const client = new TelegramClient("token", fetchImpl);

    await client.sendMessage(123, "x".repeat(4100), {
      replyMarkup: { inline_keyboard: [[{ text: "OK", callback_data: "cb:ok" }]] }
    });

    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies[0].reply_markup).toBeUndefined();
    expect(bodies.at(-1).reply_markup).toEqual({ inline_keyboard: [[{ text: "OK", callback_data: "cb:ok" }]] });
  });
});
