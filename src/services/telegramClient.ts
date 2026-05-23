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
      throw err;
    }
    if (!response.ok) {
      throw new Error(`telegram_${method}_http_${response.status}`);
    }

    const body = (await response.json()) as TelegramApiResponse<T>;
    if (!body.ok || body.result === undefined) {
      throw new Error(body.description ?? `telegram_${method}_failed`);
    }
    return body.result;
  }
}
