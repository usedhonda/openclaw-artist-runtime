import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramClient, telegramAttemptsFromError } from "../src/services/telegramClient";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function transientError(code: string): Error {
  return Object.assign(new Error("fetch failed"), {
    cause: { code, message: code }
  });
}

afterEach(() => {
  delete process.env.OPENCLAW_TELEGRAM_RETRY_MAX;
  delete process.env.OPENCLAW_TELEGRAM_RETRY_BASE_MS;
});

describe("TelegramClient retry", () => {
  it("retries transient fetch failures before returning a Telegram result", async () => {
    process.env.OPENCLAW_TELEGRAM_RETRY_MAX = "3";
    process.env.OPENCLAW_TELEGRAM_RETRY_BASE_MS = "1";
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(transientError("ETIMEDOUT"))
      .mockRejectedValueOnce(transientError("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 1, chat: { id: 123 }, text: "ok" } }));
    const client = new TelegramClient("token", fetchImpl);

    const result = await client.sendMessage(123, "hello");

    expect(result).toMatchObject({ message_id: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries 5xx and 429 but fails 4xx without retry", async () => {
    process.env.OPENCLAW_TELEGRAM_RETRY_MAX = "2";
    process.env.OPENCLAW_TELEGRAM_RETRY_BASE_MS = "1";
    const retryFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 502))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 2, chat: { id: 123 }, text: "ok" } }));
    await new TelegramClient("token", retryFetch).sendMessage(123, "ok");
    expect(retryFetch).toHaveBeenCalledTimes(2);

    const failFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 400));
    await expect(new TelegramClient("token", failFetch).sendMessage(123, "bad")).rejects.toThrow("telegram_sendMessage_http_400");
    expect(failFetch).toHaveBeenCalledTimes(1);
  });

  it("exposes exhausted attempt count on errors", async () => {
    process.env.OPENCLAW_TELEGRAM_RETRY_MAX = "2";
    process.env.OPENCLAW_TELEGRAM_RETRY_BASE_MS = "1";
    const fetchImpl = vi.fn().mockRejectedValue(transientError("EAI_AGAIN"));

    let caught: unknown;
    try {
      await new TelegramClient("token", fetchImpl).sendMessage(123, "bad");
    } catch (error) {
      caught = error;
    }

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(telegramAttemptsFromError(caught)).toBe(2);
  });
});
