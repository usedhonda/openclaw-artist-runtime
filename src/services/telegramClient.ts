import type { TelegramMessage, TelegramReplyMarkup, TelegramUpdate } from "../types.js";

export type { TelegramCallbackQuery, TelegramChat, TelegramInlineKeyboard, TelegramInlineKeyboardButton, TelegramMessage, TelegramReplyMarkup, TelegramUpdate, TelegramUser } from "../types.js";

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramSendMessageOptions {
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disableNotification?: boolean;
  replyMarkup?: TelegramReplyMarkup;
}

export interface TelegramAnswerCallbackQueryOptions {
  text?: string;
  showAlert?: boolean;
}

export type TelegramFetch = (input: string, init: RequestInit) => Promise<Response>;

const TRANSIENT_ERROR_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"]);

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function retryMaxForMethod(method: string): number {
  if (method === "getUpdates") {
    return 1;
  }
  return positiveIntegerFromEnv("OPENCLAW_TELEGRAM_RETRY_MAX", 3);
}

function retryBaseMs(): number {
  return positiveIntegerFromEnv("OPENCLAW_TELEGRAM_RETRY_BASE_MS", 1000);
}

function retryDelayMs(attempt: number): number {
  return retryBaseMs() * (3 ** Math.max(0, attempt - 1));
}

function causeCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string; errno?: string } }).cause;
  return cause?.code ?? cause?.errno;
}

function isTransientFetchError(error: unknown): boolean {
  const code = causeCode(error);
  return code === undefined || TRANSIENT_ERROR_CODES.has(code);
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function attachTelegramAttempts<T extends Error>(error: T, attempts: number): T {
  (error as T & { telegramAttempts?: number }).telegramAttempts = attempts;
  return error;
}

export function telegramAttemptsFromError(error: unknown): number | undefined {
  const attempts = (error as { telegramAttempts?: unknown })?.telegramAttempts;
  return typeof attempts === "number" && Number.isFinite(attempts) ? attempts : undefined;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(
    token: string,
    private readonly fetchImpl: TelegramFetch = fetch
  ) {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error("telegram token is required");
    }
    this.baseUrl = `https://api.telegram.org/bot${trimmed}`;
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    const payload: Record<string, unknown> = {
      timeout: 25,
      allowed_updates: ["message", "callback_query"]
    };
    if (offset !== undefined) {
      payload.offset = offset;
    }
    return this.call<TelegramUpdate[]>("getUpdates", payload);
  }

  async sendMessage(chatId: number | string, text: string, options: TelegramSendMessageOptions = {}): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode,
      disable_notification: options.disableNotification,
      reply_markup: options.replyMarkup
    });
  }

  async answerCallbackQuery(callbackQueryId: string, options: TelegramAnswerCallbackQueryOptions = {}): Promise<boolean> {
    return this.call<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: options.text,
      show_alert: options.showAlert
    });
  }

  async editMessageReplyMarkup(chatId: number | string, messageId: number, replyMarkup: TelegramReplyMarkup): Promise<TelegramMessage | boolean> {
    return this.call<TelegramMessage | boolean>("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    });
  }

  async editMessageText(chatId: number | string, messageId: number, text: string, options: TelegramSendMessageOptions = {}): Promise<TelegramMessage | boolean> {
    return this.call<TelegramMessage | boolean>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: options.parseMode,
      disable_notification: options.disableNotification,
      reply_markup: options.replyMarkup
    });
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const maxAttempts = retryMaxForMethod(method);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/${method}`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        const cause = (err as { cause?: { code?: string; message?: string; errno?: string } }).cause;
        console.error(`[telegram-client] fetch ${method} threw: msg=${(err as Error).message} cause_code=${cause?.code ?? "(none)"} cause_errno=${cause?.errno ?? "(none)"} cause_msg=${cause?.message ?? "(none)"}`);
        lastError = err;
        if (attempt < maxAttempts && isTransientFetchError(err)) {
          const delayMs = retryDelayMs(attempt);
          console.log(`[telegram-client] retry ${method} attempt=${attempt + 1}/${maxAttempts} reason=fetch_${causeCode(err) ?? "throw"} delayMs=${delayMs}`);
          await sleep(delayMs);
          continue;
        }
        if (err instanceof Error) {
          throw attachTelegramAttempts(err, attempt);
        }
        throw attachTelegramAttempts(new Error(String(err)), attempt);
      }
      if (!response.ok) {
        const error = attachTelegramAttempts(new Error(`telegram_${method}_http_${response.status}`), attempt);
        lastError = error;
        if (attempt < maxAttempts && isTransientHttpStatus(response.status)) {
          const delayMs = retryDelayMs(attempt);
          console.log(`[telegram-client] retry ${method} attempt=${attempt + 1}/${maxAttempts} reason=http_${response.status} delayMs=${delayMs}`);
          await sleep(delayMs);
          continue;
        }
        throw error;
      }

      const body = (await response.json()) as TelegramApiResponse<T>;
      if (!body.ok || body.result === undefined) {
        throw attachTelegramAttempts(new Error(body.description ?? `telegram_${method}_failed`), attempt);
      }
      return body.result;
    }
    if (lastError instanceof Error) {
      throw attachTelegramAttempts(lastError, maxAttempts);
    }
    throw attachTelegramAttempts(new Error(`telegram_${method}_failed_after_retry`), maxAttempts);
  }
}
