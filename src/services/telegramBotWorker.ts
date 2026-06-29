import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AiReviewProvider, AutopilotStatus, TelegramConfig } from "../types.js";
import { readPersonaSetupStatus } from "./personaSetupDetector.js";
import { getTelegramOwnerUserIds } from "./telegramAuth.js";
import { TelegramClient, type TelegramFetch, type TelegramUpdate } from "./telegramClient.js";
import { classifyTelegramFreeText, routeTelegramCommand, storeTelegramInbox, type TelegramStatusDecisionAction, type TelegramStatusDecisionButtonsRequest } from "./telegramCommandRouter.js";
import { routeTelegramCallback } from "./telegramCallbackHandler.js";
import { handleTelegramPersonaSessionMessage, readTelegramPersonaSession } from "./telegramPersonaSession.js";
import { getDashboardBaseUrl, getTelegramBotToken, isInlineButtonsEnabled, isLegacyWizardEnabled } from "./runtimeConfig.js";
import { markPendingCallbacksForSongResolved, registerCallbackAction } from "./callbackActionRegistry.js";
import { buildProposalInlineKeyboard } from "./freeformChangesetProposer.js";
import type { TelegramProposalButtonsRequest } from "./telegramConversationalRouter.js";
import { buttonVoiceLabels } from "./buttonVoiceLabels.js";
import { readSongState } from "./artistState.js";

export interface TelegramBotWorkerOptions {
  root: string;
  config: TelegramConfig;
  token?: string;
  ownerUserIds?: Set<string>;
  fetchImpl?: TelegramFetch;
  getAutopilotStatus?: () => Promise<AutopilotStatus>;
  aiReviewProvider?: AiReviewProvider;
  dashboardBaseUrl?: string;
}

export interface TelegramPollResult {
  enabled: boolean;
  fetched: boolean;
  processed: number;
  nextOffset?: number;
  backoffMs?: number;
  error?: string;
  reason?: "disabled_config" | "missing_token" | "missing_owner_allowlist";
}

interface TelegramWorkerState {
  offset?: number;
  chatId?: number;
  personaSetupAnnouncedAt?: number;
}

function statePath(root: string): string {
  return join(root, "runtime", "telegram-state.json");
}

async function readState(root: string): Promise<TelegramWorkerState> {
  const contents = await readFile(statePath(root), "utf8").catch(() => "");
  if (!contents) {
    return {};
  }
  try {
    const parsed = JSON.parse(contents) as Partial<TelegramWorkerState>;
    return {
      ...(Number.isInteger(parsed.offset) ? { offset: parsed.offset } : {}),
      ...(Number.isInteger(parsed.chatId) ? { chatId: parsed.chatId } : {}),
      ...(Number.isFinite(parsed.personaSetupAnnouncedAt) ? { personaSetupAnnouncedAt: parsed.personaSetupAnnouncedAt } : {})
    };
  } catch {
    return {};
  }
}

async function writeState(root: string, state: TelegramWorkerState): Promise<void> {
  const path = statePath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function logTelegramWorkerSideEffectFailure(context: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[telegram-bot-worker] ${context} failed: ${reason}`);
}

function statusDecisionButtonLabel(action: TelegramStatusDecisionAction, context?: { sunoUrlReady?: boolean }): string {
  switch (action) {
    case "song_archive":
      if (context?.sunoUrlReady) return buttonVoiceLabels.sunoUrlReady.archive;
      return buttonVoiceLabels.songCompletion.archive;
    case "song_discard":
      if (context?.sunoUrlReady) return buttonVoiceLabels.sunoUrlReady.discard;
      return buttonVoiceLabels.songCompletion.discard;
    case "song_songbook_write":
      return buttonVoiceLabels.songCompletion.write;
    case "song_skip":
      return buttonVoiceLabels.songCompletion.later;
    case "song_spawn_inject":
      return buttonVoiceLabels.songSpawn.inject;
    case "song_spawn_skip":
      return buttonVoiceLabels.songSpawn.skip;
    case "song_spawn_edit":
      return buttonVoiceLabels.songSpawn.edit;
    case "prompt_pack_go":
      return buttonVoiceLabels.promptPackReady.go;
    case "prompt_pack_edit":
      return buttonVoiceLabels.promptPackReady.edit;
    case "prompt_pack_skip":
      return buttonVoiceLabels.promptPackReady.skip;
    case "lyrics_redraft":
      return buttonVoiceLabels.lyricsDegraded.redraft;
    case "planning_skeleton_apply":
      return buttonVoiceLabels.planningSkeleton.apply;
    case "planning_skeleton_skip":
      return buttonVoiceLabels.planningSkeleton.skip;
    case "planning_skeleton_edit":
      return buttonVoiceLabels.planningSkeleton.edit;
  }
}

const STATUS_DECISION_ACTION_SET = new Set<string>([
  "song_archive",
  "song_discard",
  "song_songbook_write",
  "song_skip",
  "song_spawn_inject",
  "song_spawn_skip",
  "song_spawn_edit",
  "prompt_pack_go",
  "prompt_pack_edit",
  "prompt_pack_skip",
  "lyrics_redraft",
  "planning_skeleton_apply",
  "planning_skeleton_skip",
  "planning_skeleton_edit"
]);

export class TelegramBotWorker {
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private backoffMs = 0;
  private readonly token: string | undefined;
  private readonly ownerUserIds: Set<string>;

  constructor(private readonly options: TelegramBotWorkerOptions) {
    this.token = options.token ?? getTelegramBotToken();
    this.ownerUserIds = options.ownerUserIds ?? getTelegramOwnerUserIds();
  }

  async start(): Promise<TelegramPollResult> {
    const disabled = this.disabledReason();
    if (disabled) {
      return { enabled: false, fetched: false, processed: 0, reason: disabled };
    }
    this.running = true;
    const client = new TelegramClient(this.token ?? "", this.options.fetchImpl);
    await this.pushStartupPersonaAnnouncement(client)
      .catch((error) => logTelegramWorkerSideEffectFailure("startup persona announcement", error));
    const result = await this.pollOnce();
    this.scheduleNext();
    return result;
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async pollOnce(): Promise<TelegramPollResult> {
    const disabled = this.disabledReason();
    if (disabled) {
      return { enabled: false, fetched: false, processed: 0, reason: disabled };
    }

    try {
      const client = new TelegramClient(this.token ?? "", this.options.fetchImpl);
      const current = await readState(this.options.root);
      const updates = await client.getUpdates(current.offset);
      const nextOffset = this.nextOffset(updates, current.offset);
      let processed = 0;
      for (const update of updates) {
        if (await this.handleUpdate(client, update)) {
          processed += 1;
        }
      }
      if (nextOffset !== undefined) {
        await writeState(this.options.root, { ...(await readState(this.options.root)), offset: nextOffset });
      }
      this.backoffMs = 0;
      return { enabled: true, fetched: true, processed, nextOffset };
    } catch (error) {
      this.backoffMs = Math.min(Math.max(this.options.config.pollIntervalMs * 2, 1000), 60000);
      return {
        enabled: true,
        fetched: true,
        processed: 0,
        backoffMs: this.backoffMs,
        error: error instanceof Error ? error.message : "telegram_poll_failed"
      };
    }
  }

  private disabledReason(): TelegramPollResult["reason"] | undefined {
    if (!this.options.config.enabled) {
      return "disabled_config";
    }
    if (!this.token?.trim()) {
      return "missing_token";
    }
    if (this.ownerUserIds.size === 0) {
      return "missing_owner_allowlist";
    }
    return undefined;
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }
    const delayMs = this.backoffMs || this.options.config.pollIntervalMs;
    this.timer = setTimeout(() => {
      void this.pollOnce().finally(() => this.scheduleNext());
    }, delayMs);
    this.timer.unref();
  }

  private nextOffset(updates: TelegramUpdate[], currentOffset: number | undefined): number | undefined {
    const maxUpdateId = updates.reduce<number | undefined>(
      (current, update) => (current === undefined || update.update_id > current ? update.update_id : current),
      undefined
    );
    if (maxUpdateId === undefined) {
      return currentOffset;
    }
    return maxUpdateId + 1;
  }

  private async handleUpdate(client: TelegramClient, update: TelegramUpdate): Promise<boolean> {
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message?.chat.id;
      const messageId = callback.message?.message_id;
      if (!this.ownerUserIds.has(String(callback.from.id)) || chatId === undefined || messageId === undefined) {
        if (this.ownerUserIds.has(String(callback.from.id))) {
          await client.answerCallbackQuery(callback.id, { text: "Unsupported action" })
            .catch((error) => logTelegramWorkerSideEffectFailure("unsupported callback answer", error));
        }
        return false;
      }
      await routeTelegramCallback({
        root: this.options.root,
        client,
        callbackQueryId: callback.id,
        data: callback.data,
        fromUserId: callback.from.id,
        chatId,
        messageId
      });
      return true;
    }

    const message = update.message;
    const from = message?.from;
    const text = message?.text;
    if (!message || !from || !text || !this.ownerUserIds.has(String(from.id))) {
      return false;
    }
    await this.rememberChatId(message.chat.id);

    const session = isLegacyWizardEnabled() ? await readTelegramPersonaSession(this.options.root) : undefined;
    const sessionResponse = session ? await handleTelegramPersonaSessionMessage(this.options.root, text) : undefined;
    const route = sessionResponse
      ? {
          shouldStoreFreeText: false,
          responseText: sessionResponse,
          proposalButtons: undefined,
          statusDecisionButtons: undefined
        }
      : await routeTelegramCommand({
          text,
          fromUserId: from.id,
          chatId: message.chat.id,
          workspaceRoot: this.options.root,
          autopilotStatus: await this.options.getAutopilotStatus?.(),
          aiReviewProvider: this.options.aiReviewProvider,
          dashboardBaseUrl: this.options.dashboardBaseUrl ?? getDashboardBaseUrl()
        });
    if (route.shouldStoreFreeText && !this.options.config.acceptFreeText) {
      await client.sendMessage(message.chat.id, "Free text intake is disabled in settings.");
      return true;
    }
    if (route.shouldStoreFreeText) {
      await storeTelegramInbox(this.options.root, {
        type: "free_text",
        intent: classifyTelegramFreeText(text),
        fromUserId: from.id,
        chatId: message.chat.id,
        text,
        timestamp: Date.now()
      });
    }
    const responseText = await this.withPersonaSetupAnnouncement(route.responseText);
    const sent = await client.sendMessage(message.chat.id, responseText);
    if (route.proposalButtons && isInlineButtonsEnabled()) {
      await this.attachProposalButtons(client, {
        ...route.proposalButtons,
        chatId: message.chat.id,
        messageId: sent.message_id,
        userId: from.id
      });
    }
    if (route.statusDecisionButtons && isInlineButtonsEnabled()) {
      await this.attachStatusDecisionButtons(client, {
        ...route.statusDecisionButtons,
        chatId: message.chat.id,
        messageId: sent.message_id,
        userId: from.id
      });
    }
    return true;
  }

  private async attachProposalButtons(
    client: TelegramClient,
    input: TelegramProposalButtonsRequest & { chatId: number; messageId: number; userId: number }
  ): Promise<void> {
    const [yes, no, edit] = await Promise.all([
      registerCallbackAction(this.options.root, {
        action: "proposal_yes",
        proposalId: input.proposalId,
        chatId: input.chatId,
        messageId: input.messageId,
        userId: input.userId
      }),
      registerCallbackAction(this.options.root, {
        action: "proposal_no",
        proposalId: input.proposalId,
        chatId: input.chatId,
        messageId: input.messageId,
        userId: input.userId
      }),
      registerCallbackAction(this.options.root, {
        action: "proposal_edit_open",
        proposalId: input.proposalId,
        chatId: input.chatId,
        messageId: input.messageId,
        userId: input.userId
      })
    ]);
    await client.editMessageReplyMarkup(input.chatId, input.messageId, {
      inline_keyboard: buildProposalInlineKeyboard({
        yes: `cb:${yes.callbackId}`,
        no: `cb:${no.callbackId}`,
        edit: `cb:${edit.callbackId}`
      })
    });
  }

  private async attachStatusDecisionButtons(
    client: TelegramClient,
    input: TelegramStatusDecisionButtonsRequest & { chatId: number; messageId: number; userId: number }
  ): Promise<void> {
    const song = await readSongState(this.options.root, input.songId).catch(() => undefined);
    const labelContext = { sunoUrlReady: song?.status === "suno_take_url_ready" };
    await markPendingCallbacksForSongResolved(this.options.root, {
      songId: input.songId,
      actions: STATUS_DECISION_ACTION_SET,
      status: "updated",
      reason: "superseded_by_status_decision_reissue"
    });
    const callbacks = await Promise.all(input.actions.map(async (action) => ({
      action,
      entry: await registerCallbackAction(this.options.root, {
        action,
        proposalId: input.proposalId,
        songId: input.songId,
        selectedTakeId: input.selectedTakeId,
        commissionBrief: input.commissionBrief,
        spawnReason: input.spawnReason,
        chatId: input.chatId,
        messageId: input.messageId,
        userId: input.userId
      })
    })));
    await client.editMessageReplyMarkup(input.chatId, input.messageId, {
      inline_keyboard: [callbacks.map(({ action, entry }) => ({
        text: statusDecisionButtonLabel(action, labelContext),
        callback_data: `cb:${entry.callbackId}`
      }))]
    });
  }

  private async rememberChatId(chatId: number): Promise<void> {
    const state = await readState(this.options.root);
    if (state.chatId === chatId) {
      return;
    }
    await writeState(this.options.root, { ...state, chatId });
  }

  private async pushStartupPersonaAnnouncement(client: TelegramClient): Promise<void> {
    const state = await readState(this.options.root);
    if (!state.chatId || state.personaSetupAnnouncedAt) {
      return;
    }
    const status = await readPersonaSetupStatus(this.options.root);
    if (!status.needsSetup) {
      return;
    }
    await client.sendMessage(state.chatId, "Artist persona is not set up yet. Send /setup to create it in Telegram.");
    await writeState(this.options.root, { ...state, personaSetupAnnouncedAt: Date.now() });
  }

  private async withPersonaSetupAnnouncement(responseText: string): Promise<string> {
    const state = await readState(this.options.root);
    if (state.personaSetupAnnouncedAt) {
      return responseText;
    }
    const status = await readPersonaSetupStatus(this.options.root);
    if (!status.needsSetup) {
      return responseText;
    }
    await writeState(this.options.root, { ...state, personaSetupAnnouncedAt: Date.now() });
    return [
      "Artist persona is not set up yet. Send /setup to create it in Telegram.",
      "",
      responseText
    ].join("\n");
  }
}
