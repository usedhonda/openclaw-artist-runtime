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
  delete process.env.OPENCLAW_TELEGRAM_REQUEST_TIMEOUT_MS;
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

  it("fails closed on a hung send instead of waiting forever (per-request timeout)", async () => {
    process.env.OPENCLAW_TELEGRAM_RETRY_MAX = "1";
    process.env.OPENCLAW_TELEGRAM_REQUEST_TIMEOUT_MS = "20";
    // A socket that connects but never responds: resolve/reject only when the
    // request's AbortSignal fires. Without a per-request timeout this hangs forever
    // and silently wedges every queued send behind it.
    const hangUntilAbort = vi.fn((_input: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))
        );
      })
    );

    await expect(new TelegramClient("token", hangUntilAbort).sendMessage(123, "wedge")).rejects.toThrow();
    expect(hangUntilAbort).toHaveBeenCalledTimes(1);
    expect(hangUntilAbort.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
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
