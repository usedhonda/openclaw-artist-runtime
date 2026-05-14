import { resolveCallbackAction } from "./callbackActionRegistry.js";
import { resolveDefaultWorkspaceRoot } from "./runtimeConfig.js";
import { routeTelegramCallback } from "./telegramCallbackHandler.js";
import type { TelegramClient, TelegramMessage, TelegramReplyMarkup, TelegramSendMessageOptions } from "./telegramClient.js";

interface InteractiveCallbackContext {
  callbackId?: string;
  senderId?: string;
  callback?: {
    data?: string;
    payload?: string;
    messageId?: number | string;
    chatId?: number | string;
  };
  respond?: {
    reply?: (input: { text: string; buttons?: unknown }) => Promise<unknown> | unknown;
    editMessage?: (input: { text: string; buttons?: unknown }) => Promise<unknown> | unknown;
    editButtons?: (input: { buttons: unknown }) => Promise<unknown> | unknown;
    clearButtons?: () => Promise<unknown> | unknown;
  };
}

function numericId(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buttonsFromReplyMarkup(replyMarkup: TelegramReplyMarkup | undefined): unknown {
  return replyMarkup && "inline_keyboard" in replyMarkup ? replyMarkup.inline_keyboard : undefined;
}

function interactiveClient(ctx: InteractiveCallbackContext): TelegramClient {
  return {
    answerCallbackQuery: async () => true,
    editMessageReplyMarkup: async (_chatId: number | string, _messageId: number, replyMarkup: TelegramReplyMarkup) => {
      const buttons = buttonsFromReplyMarkup(replyMarkup);
      if (buttons && ctx.respond?.editButtons) {
        await ctx.respond.editButtons({ buttons });
      } else if (ctx.respond?.clearButtons) {
        await ctx.respond.clearButtons();
      }
      return true;
    },
    editMessageText: async (_chatId: number | string, _messageId: number, text: string, options: TelegramSendMessageOptions = {}) => {
      await ctx.respond?.editMessage?.({ text, buttons: buttonsFromReplyMarkup(options.replyMarkup) });
      return true;
    },
    sendMessage: async (_chatId: number | string, text: string, options: TelegramSendMessageOptions = {}) => {
      await ctx.respond?.reply?.({ text, buttons: buttonsFromReplyMarkup(options.replyMarkup) });
      return { message_id: 0, chat: { id: 0 } } as TelegramMessage;
    }
  } as unknown as TelegramClient;
}

export async function handleTelegramInteractiveCallback(ctx: InteractiveCallbackContext): Promise<{ handled: boolean }> {
  const data = ctx.callback?.data?.trim() ?? "";
  const callbackId = ctx.callback?.payload?.trim() || (data.startsWith("cb:") ? data.slice(3).trim() : "");
  if (!callbackId) {
    return { handled: false };
  }

  const root = resolveDefaultWorkspaceRoot();
  const entry = await resolveCallbackAction(root, callbackId);
  const fromUserId = numericId(ctx.senderId) ?? entry?.userId ?? 0;
  const chatId = numericId(ctx.callback?.chatId) ?? entry?.chatId;
  const messageId = numericId(ctx.callback?.messageId) ?? entry?.messageId;

  await routeTelegramCallback({
    root,
    client: interactiveClient(ctx),
    callbackQueryId: ctx.callbackId ?? `interactive:${callbackId}`,
    data: data || `cb:${callbackId}`,
    fromUserId,
    chatId,
    messageId,
    actor: "telegram_callback"
  });
  return { handled: true };
}
