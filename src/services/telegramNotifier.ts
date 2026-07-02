import type { RuntimeEvent, RuntimeEventBus } from "./runtimeEventBus.js";
import { TelegramClient, telegramAttemptsFromError, type TelegramFetch } from "./telegramClient.js";
import { generateArtistResponse, readArtistVoiceContext } from "./artistVoiceResponder.js";
import type { AiReviewProvider, CommissionBriefSource, ObservationSummary, ProducerDigestMode } from "../types.js";
import { markPendingCallbacksByActionResolved, markPendingCallbacksForSongResolved, registerCallbackAction } from "./callbackActionRegistry.js";
import { appendConversationTurn } from "./conversationalSession.js";
import { proposalForDetection } from "./songDistributionPoller.js";
import { getTelegramArtistReportTimeoutMs, isInlineButtonsEnabled, isSelfHealNotifyEnabled, isXInlineButtonEnabled } from "./runtimeConfig.js";
import { readSongState } from "./artistState.js";
import { secretLikePattern } from "./personaMigrator.js";
import { isUnsafeCommandVoiceTopForTest } from "./commandVoiceWrapper.js";
import { composePlanningSkeletonVoice } from "./planningSkeletonVoiceComposer.js";
import { buttonVoiceLabels } from "./buttonVoiceLabels.js";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCascadeTrace } from "./cascadeTrace.js";
import { appendFailedNotification, isCriticalNotificationEvent } from "./failedNotifyLedger.js";
import { readLatestPromptPackMetadata } from "./sunoPromptPackFiles.js";
import { readLatestCreativeQualityEntry } from "./creativeQualityLedger.js";
import { composeDraftBoxNextAction, formatDraftBoxNextActionSection } from "./draftBoxNextAction.js";
import { emitDraftBoxProactiveNoticeIfNeeded } from "./draftBoxProactiveNotice.js";
import {
  TELEGRAM_SECTION_DIVIDER,
  appendTelegramSection,
  compactLines,
  formatTelegramCascadeTrace,
  formatTelegramUrlList,
  joinTelegramDetailSection,
  stripTelegramHtmlComments,
  truncatePlain
} from "./telegramFormatting.js";

export interface TelegramNotifierOptions {
  token: string;
  chatId: string | number;
  workspaceRoot?: string;
  aiReviewProvider?: AiReviewProvider;
  fetchImpl?: TelegramFetch;
  dashboardBaseUrl?: string;
  notifyStages?: boolean;
  producerDigest?: ProducerDigestMode;
}

// Events pushed to the signal-only Producer Room. Some event types are deliberately NOT
// here — do not "revive" them by adding them without revisiting the decision below:
// - distribution_change_detected: excluded by the signal-only policy (commit 1c7b8a0
//   "enforce signal-only producer room"). tests/telegram-distribution-apply-callback-e2e.test.ts
//   asserts it stays out of Telegram and mints no apply buttons. Its formatter, callback
//   actions, and attachDistributionButtons helper exist but are intentionally unwired.
// - take_select_low_score: a dead event type. Nothing emits it (the take-selection stage
//   emits take_select_pending / take_selection_stalled / song_take_completed instead, and
//   tests/autopilot-take-select-stage.test.ts asserts it is never emitted), so adding it
//   here would be a no-op.
// producer_decision_reminder is delivered directly by callbackPollingWatchdog (its own
// sendMessage), not through this gate, so it is absent here by design — adding it would
// double-send.
const TELEGRAM_SIGNAL_EVENT_TYPES: ReadonlySet<RuntimeEvent["type"]> = new Set([
  "song_spawn_proposed",
  "prompt_pack_ready",
  "song_take_completed",
  "suno_take_url_ready",
  "suno_adoption_download_imported",
  "suno_adoption_download_failed",
  "lyrics_generation_degraded",
  "planning_skeleton_incomplete",
  "artist_proactive_notice",
  "take_selection_stalled",
  "asset_generation_stalled",
  "suno_generate_failed"
]);

const HARD_STOP_REASON_PATTERNS: Array<{ category: string; pattern: RegExp; message: string }> = [
  {
    category: "login",
    pattern: /(?:login|session|auth|reauth|manual[_ -]?handoff)/i,
    message: "Suno のログインが切れた。再ログインして /resume すると曲が再開する。"
  },
  {
    category: "captcha",
    pattern: /captcha/i,
    message: "Suno が CAPTCHA で止まった。画面で確認して /resume すると曲が再開する。"
  },
  {
    category: "payment",
    pattern: /(?:payment|credit)/i,
    message: "Suno の支払い/credit 確認で止まった。Suno 側を確認して /resume して。"
  },
  {
    category: "ui_mismatch",
    pattern: /(?:ui[_ -]?mismatch|selector[_ -]?mismatch)/i,
    message: "Suno の画面が変わった。状態を確認して /resume すると曲が再開する。"
  }
];
const SUNO_URL_READY_ACTIONS = new Set(["song_archive", "song_discard"]);
const SONG_COMPLETION_ACTIONS = new Set(["song_archive", "song_discard", "song_songbook_write", "song_skip", "x_publish_prepare"]);
const SONG_SPAWN_ACTIONS = new Set(["song_spawn_inject", "song_spawn_skip", "song_spawn_edit"]);

function hardStopCategory(reason: string): string | undefined {
  return HARD_STOP_REASON_PATTERNS.find((entry) => entry.pattern.test(reason))?.category;
}

function hardStopMessage(reason: string): string {
  return HARD_STOP_REASON_PATTERNS.find((entry) => entry.pattern.test(reason))?.message
    ?? "Suno が手動確認で止まった。状態を確認して /resume すると曲が再開する。";
}

function isSunoErrorSource(source: string): boolean {
  return /suno/i.test(source);
}

function isActionableSunoHardStop(event: RuntimeEvent): event is Extract<RuntimeEvent, { type: "suno_hard_stop" | "error" }> {
  if (event.type === "suno_hard_stop") {
    return hardStopCategory(event.reason) !== undefined;
  }
  if (event.type === "error") {
    return isSunoErrorSource(event.source) && hardStopCategory(event.reason) !== undefined;
  }
  return false;
}

const TELEGRAM_COMMAND_FAILURE_SOURCES: ReadonlySet<string> = new Set([
  "telegram_manual_song_create",
  "telegram_resume_run_now"
]);

function isTelegramCommandFailure(event: RuntimeEvent): event is Extract<RuntimeEvent, { type: "error" }> {
  return event.type === "error" && TELEGRAM_COMMAND_FAILURE_SOURCES.has(event.source);
}

export function isTelegramSignalEvent(event: RuntimeEvent): boolean {
  return TELEGRAM_SIGNAL_EVENT_TYPES.has(event.type) || isActionableSunoHardStop(event) || isTelegramCommandFailure(event);
}

export function isTelegramSilentEvent(event: RuntimeEvent): boolean {
  return !isTelegramSignalEvent(event);
}

// Plan v10.56 Phase 4: autonomous self-heal events surfaced to Telegram (opt-in).
// These are normally silent "error"-type events; when OPENCLAW_SELF_HEAL_NOTIFY=on the
// runtime tells the producer "I recovered myself" in plain JA so the silence gap closes.
const SELF_HEAL_SOURCES: ReadonlySet<string> = new Set([
  "autopilot_ticker_stall",
  "stale_queue_cleanup"
]);
const SELF_HEAL_DEDUP_WINDOW_MS = 60 * 60 * 1000;

function selfHealDedupKey(event: Extract<RuntimeEvent, { type: "error" }>): string {
  return `${event.source}:${event.reason}`;
}

function formatSelfHealText(event: Extract<RuntimeEvent, { type: "error" }>): string {
  const label = event.source === "stale_queue_cleanup"
    ? "古い曲を自動で整理した"
    : "処理が詰まったので自動で立て直した";
  return [
    `🛠 自己修復: ${label}。`,
    event.songId ? `song: ${event.songId}` : undefined,
    `詳細: ${event.reason}`,
    "操作は不要。"
  ].filter(Boolean).join("\n");
}

function formatActionableHardStopText(event: Extract<RuntimeEvent, { type: "suno_hard_stop" | "error" }>): string {
  return [
    hardStopMessage(event.reason),
    event.songId ? `song: ${event.songId}` : undefined
  ].filter(Boolean).join(" ");
}

function logNotifySideEffectFailure(context: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[telegram-notify] ${context} failed: ${reason}`);
}

export class TelegramNotifier {
  private readonly client: TelegramClient;
  private spawnBuffer: Array<{
    event: Extract<RuntimeEvent, { type: "song_spawn_proposed" }>;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private spawnFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly recentSelfHealNotifications = new Map<string, number>();

  constructor(private readonly options: TelegramNotifierOptions) {
    this.client = new TelegramClient(options.token, options.fetchImpl);
  }

  subscribe(bus: RuntimeEventBus): () => void {
    const unsubscribe = bus.subscribe((event) => {
      void this.notify(event).catch((err) => {
        const songId = (event as { songId?: string }).songId ?? "(none)";
        console.error(`[telegram-notify] failed event=${event.type} song=${songId} err=${(err as Error)?.message ?? err}`);
        if (this.options.workspaceRoot && isCriticalNotificationEvent(event)) {
          void appendFailedNotification(this.options.workspaceRoot, {
            event,
            chatId: this.options.chatId,
            error: err,
            attempts: telegramAttemptsFromError(err)
          }).catch((ledgerError) => {
            const reason = (ledgerError as Error)?.message ?? String(ledgerError);
            console.error(`[telegram-notify] failed-notify ledger append failed event=${event.type} song=${songId} err=${reason}`);
            bus.emit({
              type: "failed_notify_ledger_append_failed",
              eventType: event.type,
              ...(songId !== "(none)" ? { songId } : {}),
              reason,
              timestamp: Date.now()
            });
          });
        }
      });
    });
    if (this.options.workspaceRoot) {
      setTimeout(() => {
        void emitDraftBoxProactiveNoticeIfNeeded(this.options.workspaceRoot!).catch((error) => {
          console.warn(`[telegram-notify] proactive startup check failed err=${(error as Error)?.message ?? error}`);
        });
      }, 0).unref?.();
    }
    return unsubscribe;
  }

  async notify(event: RuntimeEvent): Promise<void> {
    if (event.type === "error" && SELF_HEAL_SOURCES.has(event.source) && isSelfHealNotifyEnabled()) {
      const key = selfHealDedupKey(event);
      const now = Date.now();
      const lastSentAt = this.recentSelfHealNotifications.get(key);
      if (lastSentAt !== undefined && now - lastSentAt < SELF_HEAL_DEDUP_WINDOW_MS) {
        return;
      }
      this.recentSelfHealNotifications.set(key, now);
      await this.client.sendMessage(this.options.chatId, formatSelfHealText(event));
      return;
    }
    if (isActionableSunoHardStop(event)) {
      await this.client.sendMessage(this.options.chatId, formatActionableHardStopText(event));
      return;
    }
    if (this.options.producerDigest === "off") return;
    if (this.options.notifyStages === false) return;
    if (!isTelegramSignalEvent(event)) return;
    if (event.type === "song_spawn_proposed") {
      return this.enqueueSongSpawnNotification(event);
    }
    const text = await formatRuntimeEvent(event, {
      workspaceRoot: this.options.workspaceRoot,
      aiReviewProvider: this.options.aiReviewProvider,
      dashboardBaseUrl: this.options.dashboardBaseUrl
    });
    const sent = await this.client.sendMessage(this.options.chatId, text);
    if (event.type === "song_take_completed") {
      await this.attachSongCompletionButtons(event, sent.message_id);
    }
    if (event.type === "suno_take_url_ready") {
      await this.attachSunoTakeUrlReadyButtons(event, sent.message_id);
    }
    if (event.type === "prompt_pack_ready") {
      await this.attachPromptPackReadyButtons(event, sent.message_id);
    }
    if (event.type === "lyrics_generation_degraded") {
      await this.attachLyricsDegradedButtons(event, sent.message_id);
    }
    if (event.type === "planning_skeleton_incomplete") {
      await this.attachPlanningSkeletonButtons(event, sent.message_id, text);
    }
  }

  private async attachSongCompletionButtons(event: Extract<RuntimeEvent, { type: "song_take_completed" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    await markPendingCallbacksForSongResolved(this.options.workspaceRoot, {
      songId: event.songId,
      actions: SONG_COMPLETION_ACTIONS,
      status: "updated",
      reason: "superseded_by_song_take_completed"
    });
    const actions = [
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_archive",
        songId: event.songId,
        selectedTakeId: event.selectedTakeId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_discard",
        songId: event.songId,
        selectedTakeId: event.selectedTakeId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_songbook_write",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_skip",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      ...(isXInlineButtonEnabled() ? [registerCallbackAction(this.options.workspaceRoot, {
        action: "x_publish_prepare",
        songId: event.songId,
        draftUrl: event.urls[0],
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })] : [])
    ];
    const [archive, discard] = await Promise.all(actions);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.songCompletion.archive, callback_data: `cb:${archive.callbackId}` },
        { text: buttonVoiceLabels.songCompletion.discard, callback_data: `cb:${discard.callbackId}` }
      ]]
    });
  }

  private async attachSunoTakeUrlReadyButtons(event: Extract<RuntimeEvent, { type: "suno_take_url_ready" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    await markPendingCallbacksForSongResolved(this.options.workspaceRoot, {
      songId: event.songId,
      actions: SUNO_URL_READY_ACTIONS,
      status: "updated",
      reason: "superseded_by_suno_take_url_ready"
    });
    const [archive, discard] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_archive",
        songId: event.songId,
        selectedTakeId: event.selectedTakeId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_discard",
        songId: event.songId,
        selectedTakeId: event.selectedTakeId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.sunoUrlReady.archive, callback_data: `cb:${archive.callbackId}` },
        { text: buttonVoiceLabels.sunoUrlReady.discard, callback_data: `cb:${discard.callbackId}` }
      ]]
    });
  }

  private async attachDistributionButtons(event: Extract<RuntimeEvent, { type: "distribution_change_detected" }>, messageId: number, text: string): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const proposal = event.proposal ?? proposalForDetection({
      songId: event.songId,
      title: event.songId,
      platform: event.platform,
      url: event.url,
      detectedAt: new Date(event.timestamp).toISOString()
    });
    await appendConversationTurn(this.options.workspaceRoot, {
      chatId: this.options.chatId,
      userId: this.options.chatId,
      topic: { kind: "song", songId: event.songId },
      pendingChangeSet: proposal,
      turn: { role: "artist", text }
    });
    const [apply, skip] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "dist_apply",
        proposalId: proposal.id,
        songId: event.songId,
        platform: event.platform,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "dist_skip",
        proposalId: proposal.id,
        songId: event.songId,
        platform: event.platform,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.distribution.apply, callback_data: `cb:${apply.callbackId}` },
        { text: buttonVoiceLabels.distribution.later, callback_data: `cb:${skip.callbackId}` }
      ]]
    });
  }

  private async attachDailyVoiceButtons(event: Extract<RuntimeEvent, { type: "artist_pulse_drafted" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const [publish, edit, cancel] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "daily_voice_publish",
        draftText: event.draftText,
        draftHash: event.draftHash,
        draftCharCount: event.charCount,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "daily_voice_edit",
        draftHash: event.draftHash,
        draftCharCount: event.charCount,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "daily_voice_cancel",
        draftHash: event.draftHash,
        draftCharCount: event.charCount,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.dailyVoice.publish, callback_data: `cb:${publish.callbackId}` },
        { text: buttonVoiceLabels.dailyVoice.edit, callback_data: `cb:${edit.callbackId}` },
        { text: buttonVoiceLabels.dailyVoice.cancel, callback_data: `cb:${cancel.callbackId}` }
      ]]
    });
  }

  private enqueueSongSpawnNotification(event: Extract<RuntimeEvent, { type: "song_spawn_proposed" }>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.spawnBuffer.push({ event, resolve, reject });
      if (this.spawnFlushTimer) {
        return;
      }
      this.spawnFlushTimer = setTimeout(() => {
        this.spawnFlushTimer = undefined;
        const batch = this.spawnBuffer;
        this.spawnBuffer = [];
        void this.notifySongSpawnBatch(batch.map((item) => item.event)).then(() => {
          batch.forEach((item) => item.resolve());
        }).catch((error) => {
          batch.forEach((item) => item.reject(error));
        });
      }, 0);
    });
  }

  private async notifySongSpawnBatch(events: Array<Extract<RuntimeEvent, { type: "song_spawn_proposed" }>>): Promise<void> {
    if (events.length === 0) return;
    const event = events.at(-1)!;
    const text = await formatRuntimeEvent(event, {
      workspaceRoot: this.options.workspaceRoot,
      aiReviewProvider: this.options.aiReviewProvider,
      dashboardBaseUrl: this.options.dashboardBaseUrl
    });
    const sent = await this.client.sendMessage(this.options.chatId, text);
    await this.attachSongSpawnButtons(event, sent.message_id);
  }

  private async attachSongSpawnButtons(event: Extract<RuntimeEvent, { type: "song_spawn_proposed" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    await markPendingCallbacksByActionResolved(this.options.workspaceRoot, {
      actions: SONG_SPAWN_ACTIONS,
      excludeSongId: event.candidateSongId,
      status: "updated",
      reason: "superseded_by_new_song_spawn_proposal"
    });
    const [inject, skip, edit] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_spawn_inject",
        proposalId: event.candidateSongId,
        songId: event.candidateSongId,
        commissionBrief: event.brief,
        spawnReason: event.reason,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_spawn_skip",
        proposalId: event.candidateSongId,
        songId: event.candidateSongId,
        commissionBrief: event.brief,
        spawnReason: event.reason,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_spawn_edit",
        proposalId: event.candidateSongId,
        songId: event.candidateSongId,
        commissionBrief: event.brief,
        spawnReason: event.reason,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.songSpawn.inject, callback_data: `cb:${inject.callbackId}` },
        { text: buttonVoiceLabels.songSpawn.skip, callback_data: `cb:${skip.callbackId}` },
        { text: buttonVoiceLabels.songSpawn.edit, callback_data: `cb:${edit.callbackId}` }
      ]]
    });
  }

  private async attachPromptPackReadyButtons(event: Extract<RuntimeEvent, { type: "prompt_pack_ready" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const [go, edit, skip] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "prompt_pack_go",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "prompt_pack_edit",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "prompt_pack_skip",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.promptPackReady.go, callback_data: `cb:${go.callbackId}` },
        { text: buttonVoiceLabels.promptPackReady.edit, callback_data: `cb:${edit.callbackId}` },
        { text: buttonVoiceLabels.promptPackReady.skip, callback_data: `cb:${skip.callbackId}` }
      ]]
    });
  }

  private async attachLyricsDegradedButtons(event: Extract<RuntimeEvent, { type: "lyrics_generation_degraded" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const [redraft, discard] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "lyrics_redraft",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "song_discard",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.lyricsDegraded.redraft, callback_data: `cb:${redraft.callbackId}` },
        { text: buttonVoiceLabels.lyricsDegraded.discard, callback_data: `cb:${discard.callbackId}` }
      ]]
    });
  }

  private async attachPlanningSkeletonButtons(event: Extract<RuntimeEvent, { type: "planning_skeleton_incomplete" }>, messageId: number, text: string): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    await appendConversationTurn(this.options.workspaceRoot, {
      chatId: this.options.chatId,
      userId: this.options.chatId,
      topic: { kind: "song", songId: event.songId },
      pendingChangeSet: event.proposal,
      turn: { role: "artist", text }
    });
    const [apply, skip, edit] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "planning_skeleton_apply",
        proposalId: event.proposal.id,
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "planning_skeleton_skip",
        proposalId: event.proposal.id,
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "planning_skeleton_edit",
        proposalId: event.proposal.id,
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.planningSkeleton.apply, callback_data: `cb:${apply.callbackId}` },
        { text: buttonVoiceLabels.planningSkeleton.skip, callback_data: `cb:${skip.callbackId}` },
        { text: buttonVoiceLabels.planningSkeleton.edit, callback_data: `cb:${edit.callbackId}` }
      ]]
    });
  }

  // Intentionally unwired: take_select_low_score is a dead event type (nothing emits it; see
  // the note on TELEGRAM_SIGNAL_EVENT_TYPES). Kept rather than deleted because the type still
  // participates in the RuntimeEvent union and its exhaustive switches — removal would cascade
  // across runtimeEventBus and the formatter/callback maps with no behavioral benefit.
  private async attachTakeSelectButtons(event: Extract<RuntimeEvent, { type: "take_select_low_score" }>, messageId: number): Promise<void> {
    if (!isInlineButtonsEnabled() || !this.options.workspaceRoot || typeof this.options.chatId !== "number") {
      return;
    }
    const [accept, regen, skip] = await Promise.all([
      registerCallbackAction(this.options.workspaceRoot, {
        action: "take_select_accept",
        songId: event.songId,
        selectedTakeId: event.bestTakeId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "take_select_regenerate",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      }),
      registerCallbackAction(this.options.workspaceRoot, {
        action: "take_select_skip",
        songId: event.songId,
        chatId: this.options.chatId,
        messageId,
        userId: this.options.chatId
      })
    ]);
    await this.client.editMessageReplyMarkup(this.options.chatId, messageId, {
      inline_keyboard: [[
        { text: buttonVoiceLabels.takeSelect.accept, callback_data: `cb:${accept.callbackId}` },
        { text: buttonVoiceLabels.takeSelect.regenerate, callback_data: `cb:${regen.callbackId}` },
        { text: buttonVoiceLabels.takeSelect.skip, callback_data: `cb:${skip.callbackId}` }
      ]]
    });
  }
}

const ARTIST_REPORT_TIMEOUT_SENTINEL = Symbol("artist-report-timeout");

function artistReportTimeoutMs(): number {
  return getTelegramArtistReportTimeoutMs() ?? 12_000;
}

async function artistReport(event: RuntimeEvent, fallback: string, options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider">): Promise<string> {
  if (!options.workspaceRoot) {
    return fallback;
  }
  // The artist-voice line is composed by an AI call (generateArtistResponse). If that
  // call hangs (slow/unreachable provider), the whole notification blocks before
  // sendMessage ever runs — no send, no error, no failed-notify entry, just a silent
  // wedge. Race it against a deadline and fall back to the deterministic text so a
  // notification always reaches the producer. Real errors still propagate (-> retry /
  // failed-notify) so they stay recoverable.
  const work = (async () => {
    const context = await readArtistVoiceContext(options.workspaceRoot!, {
      topic: event.type,
      recentHistory: [fallback]
    });
    const response = await generateArtistResponse(fallback, context, {
      intent: "report",
      aiReviewProvider: options.aiReviewProvider
    });
    return response.text;
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof ARTIST_REPORT_TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(ARTIST_REPORT_TIMEOUT_SENTINEL), artistReportTimeoutMs());
  });

  try {
    const result = await Promise.race([work, deadline]);
    if (result === ARTIST_REPORT_TIMEOUT_SENTINEL) {
      console.error(`[telegram-notify] artistReport timed out after ${artistReportTimeoutMs()}ms for ${event.type}; using deterministic fallback`);
      void work.catch((error) => logNotifySideEffectFailure(`late artistReport for ${event.type}`, error));
      return fallback;
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("secret_like_text")) {
      return fallback;
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function hybridEventReport(event: RuntimeEvent, fallbackTop: string, detail: string, options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider">): Promise<string> {
  const top = sanitizeArtistTop(await artistReport(event, fallbackTop, options), fallbackTop);
  return joinTelegramDetailSection(top, detail);
}

function dailyVoiceTitle(kind: Extract<RuntimeEvent, { type: "artist_pulse_drafted" }>["voiceKind"]): string {
  if (kind === "studio_whisper") {
    return "🎵 制作中のひとこと draft:";
  }
  if (kind === "musing") {
    return "💭 つぶやき draft:";
  }
  return "🔁 引用ポスト draft:";
}

function isAllowedObservationUrl(value?: string): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && (parsed.hostname === "x.com" || parsed.hostname === "twitter.com");
  } catch {
    return false;
  }
}

function isGoogleNewsIntermediateUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.hostname === "news.google.com" && parsed.pathname.includes("/rss/articles/");
  } catch {
    return false;
  }
}

function isDisplayableNewsUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !isGoogleNewsIntermediateUrl(value);
  } catch {
    return false;
  }
}

function stripHandles(value: string): string {
  return value.replace(/@[A-Za-z0-9_]{1,20}/g, "[handle]");
}

function capQuote(value: string, max = 140): string {
  const clean = stripHandles(value).replace(/\s+/g, " ").trim();
  if (secretLikePattern.test(clean)) {
    return "[非表示]";
  }
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trim()}…` : clean;
}

function safeMotivation(value?: string): string {
  const clean = stripHandles(value ?? "").replace(/\s+/g, " ").trim();
  if (!clean || secretLikePattern.test(clean) || isMachineVoiceArtifact(clean)) {
    return "自分の都市観察と、いまの静かな違和感を、ここに繋いだ。聴いてみて、どうだろう。";
  }
  return Array.from(clean).slice(0, 160).join("");
}

function isMachineVoiceArtifact(value: string): boolean {
  return /(?:ARTIST\.md|SOUL\.md|INNER\.md|PRODUCER\.md|IDENTITY\.md|themes:|geo:|vocab:|sound:|motif anchor:|\bparse\b|\bbuild\b|\bfield\b|\bconfig\b|\bruntime\b|\bmock\b)|TBD|未定|未記入|todo|fixme|none|n\/a|基礎人格|基礎トーン|基礎理性|基礎商業|に基づき|に従い|を変換|を生成/i.test(value);
}

function safeAuthor(value?: string): string {
  const clean = (value ?? "").replace(/^@/, "").replace(/[^\w]/g, "").slice(0, 20);
  return clean || "unknown";
}

function formatObservationAuthorPrefix(value?: string): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.includes(".")) {
    return `${truncatePlain(clean, 48)}: `;
  }
  return `@${safeAuthor(clean)}: `;
}

function formatObservationSource(summary?: ObservationSummary): string[] {
  if (!summary) {
    return [
      "🌐 観察元: (記録なし)",
      "💬 抜粋: (記録なし)",
      "🎯 動機: 観察 summary なし"
    ];
  }
  const author = formatObservationAuthorPrefix(summary.author).replace(/:\s*$/, "") || "@unknown";
  const quote = capQuote(summary.quote ?? "");
  const url = isAllowedObservationUrl(summary.url) ? ` (${summary.url})` : "";
  return [
    `🌐 観察元: ${author}${url}`,
    `💬 抜粋: 「${quote || "(抜粋なし)"}」`,
    `🎯 動機: ${safeMotivation(summary.motivation)}`
  ];
}

function formatObservationMetadata(summary?: ObservationSummary): string[] {
  const [source, quote, motivation] = formatObservationSource(summary);
  return [motivation, source, quote];
}

function topRuntimeRejectReason(counts: Partial<Record<string, number>> | undefined): string | undefined {
  return Object.entries(counts ?? {})
    .filter(([, count]) => typeof count === "number" && count > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([reason, count]) => `${reason} x${count}`)[0];
}

function observationDiagnosticsSuffix(event: Extract<RuntimeEvent, { type: "observation_collected" }>): string {
  const queryCount = event.queryAttempts?.length ?? 0;
  const rawCount = event.rawCount;
  const acceptedCount = event.acceptedCount ?? event.entryCount;
  const topReject = topRuntimeRejectReason(event.rejectedCountsByReason);
  if (queryCount === 0 && rawCount === undefined && !topReject) return "";
  const rejectedCount = Object.values(event.rejectedCountsByReason ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
  return [
    typeof rawCount === "number" ? `raw ${rawCount}` : undefined,
    `accepted ${acceptedCount}`,
    rejectedCount > 0 ? `rejected ${rejectedCount}` : undefined,
    topReject ? `top: ${topReject}` : undefined,
    queryCount > 0 ? `via ${queryCount} queries` : undefined
  ].filter(Boolean).join("; ");
}

function parseSourceLine(line: string): CommissionBriefSource | undefined {
  const match = line.trim().match(/^-\s+(news|x_reaction|x):\s+(\S+)(?:\s+\(([^)]+)\))?(?:\s+—\s+(.+))?$/i);
  if (!match) return undefined;
  return {
    kind: match[1].toLowerCase() as CommissionBriefSource["kind"],
    url: match[2],
    author: match[3]?.trim(),
    quote: match[4]?.trim()
  };
}

function parseObservationSourceBlock(brief: string): CommissionBriefSource | undefined {
  const url = brief.match(/^- URL:\s+(\S+)\s*$/m)?.[1]?.trim();
  if (!url) return undefined;
  const author = brief.match(/^- Author:\s+(.+)\s*$/m)?.[1]?.trim();
  const quote = brief.match(/^- Quote:\s+(.+)\s*$/m)?.[1]?.trim();
  const kind: CommissionBriefSource["kind"] = isAllowedObservationUrl(url) ? "x_reaction" : "news";
  return { kind, url, author, quote };
}

function sourcesFromBriefText(brief: string): CommissionBriefSource[] {
  const inlineSources = brief
    .split(/\r?\n/)
    .map((line) => parseSourceLine(line))
    .filter((source): source is CommissionBriefSource => source !== undefined);
  const observationSource = parseObservationSourceBlock(brief);
  if (!observationSource || inlineSources.some((source) => source.url === observationSource.url)) {
    return inlineSources;
  }
  return [...inlineSources, observationSource];
}

function sourcesFromObservationSummary(summary?: ObservationSummary): CommissionBriefSource[] {
  if (!summary?.url || !isAllowedObservationUrl(summary.url)) return [];
  return [{
    kind: "x",
    url: summary.url,
    author: summary.author,
    quote: capQuote(summary.quote ?? "")
  }];
}

function sourceKindLabel(kind: CommissionBriefSource["kind"]): string {
  if (kind === "news") return "News";
  if (kind === "x_reaction") return "X reaction";
  return "X";
}

function formatResultSource(source: CommissionBriefSource | undefined, fallback: string): string[] {
  if (!source) return [`${fallback}: 記録なし`];
  const url = source.kind === "news" ? (
    isDisplayableNewsUrl(source.url) ? source.url : undefined
  ) : (
    isAllowedObservationUrl(source.url) ? source.url : undefined
  );
  const quote = source.quote ? capQuote(source.quote, 120) : undefined;
  return [
    `${fallback}: ${sourceKindLabel(source.kind)}${source.author ? ` / ${source.author}` : ""}`,
    quote ? `抜粋: 「${quote}」` : undefined,
    url ? `URL: ${url}` : undefined,
    typeof source.impactScore === "number" ? `反応の強さ: ${source.impactScore}` : undefined
  ].filter((line): line is string => Boolean(line));
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const charCounts = metadata?.charCounts;
  if (!charCounts || typeof charCounts !== "object") return undefined;
  const value = (charCounts as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function formatLyricsCheck(metadata: Record<string, unknown> | undefined): string[] {
  const lyrics = metadataNumber(metadata, "lyrics");
  const submitted = metadataNumber(metadata, "submittedPayloadChars");
  const limit = metadataNumber(metadata, "effectiveLyricsBoxLimit");
  const bars = metadataNumber(metadata, "plannedBars");
  if (!lyrics && !submitted && !bars) return ["歌詞チェック: 記録なし"];
  const density = lyrics && bars ? Math.round(lyrics / bars) : undefined;
  return [
    `歌詞チェック: lyrics ${lyrics ?? "?"}字${submitted && limit ? ` / submitted ${submitted}/${limit}` : ""}`,
    bars ? `form: ${bars} bars` : undefined,
    density ? `rap density: ${density}字/bar` : undefined
  ].filter((line): line is string => Boolean(line));
}

async function formatCreativeQualityLine(workspaceRoot: string | undefined, songId: string): Promise<string[]> {
  if (!workspaceRoot) return [];
  const entry = await readLatestCreativeQualityEntry(workspaceRoot, songId).catch(() => undefined);
  if (!entry) return [];
  return [
    `creative: dopagaki=${entry.dopagakiActive ? "on" : "off"}, bare ${entry.bareLyricsChars}/${entry.bareLines}行, diss-bank ${entry.dissBankHitCount} hits`
  ];
}

async function formatSongResultCard(
  event: Extract<RuntimeEvent, { type: "song_take_completed" | "suno_take_url_ready" }>,
  options: Pick<TelegramNotifierOptions, "workspaceRoot">,
  args: {
    title: string;
    statusLine: string;
    urls: string;
    selectedTake?: string;
    observationSummary?: ObservationSummary;
  }
): Promise<string> {
  const brief = event.type === "song_take_completed"
    ? await readBriefForTrace(event.songId, options.workspaceRoot)
    : await readBriefForTrace(event.songId, options.workspaceRoot);
  const sources = [
    ...sourcesFromBriefText(brief),
    ...sourcesFromObservationSummary(args.observationSummary)
  ];
  const news = sources.find((source) => source.kind === "news");
  const reaction = sources.find((source) => source.kind === "x_reaction") ?? sources.find((source) => source.kind === "x");
  const metadata = options.workspaceRoot
    ? (await readLatestPromptPackMetadata(options.workspaceRoot, event.songId).catch(() => undefined))?.metadata
    : undefined;
  const trace = buildCascadeTrace({
    songId: event.songId,
    brief,
    title: args.title,
    observationSummary: args.observationSummary,
    commissionSources: sources
  });
  return compactLines([
    args.statusLine,
    `🎵 ${args.title}${args.selectedTake ? ` (selected: ${args.selectedTake})` : ""}`,
    "🔗 試聴:",
    args.urls,
    "",
    "今回の起点:",
    ...(news ? formatResultSource(news, "元ニュース") : formatResultSource(sources[0], "元ネタ")),
    "",
    "Xで拾った反応:",
    ...formatResultSource(reaction, "反応"),
    "",
    "曲への変換:",
    `1. ニュース/観察: ${truncatePlain(trace.lyricsTheme, 120)}`,
    `2. X反応: ${reaction?.quote ? capQuote(reaction.quote, 120) : "記録なし"}`,
    `3. 音: ${truncatePlain(trace.styleLayer, 120)}`,
    "4. 揺らぎ: ドパガキ/高速展開/英日比率は prompt pack と artist 設定に従う",
    "",
    ...formatLyricsCheck(metadata),
    ...(await formatCreativeQualityLine(options.workspaceRoot, event.songId)),
    "",
    ...formatObservationMetadata(args.observationSummary),
    event.type === "suno_take_url_ready" ? "「採用して音源取得」でアーカイブし、音源ファイル取得を予約する。取れなくてもこのURLは有効。" : "完成しました。採用/破棄は後からで結構です。",
    "非公開、御大のみ"
  ], 3200);
}

function compactForArtistTop(value: string | undefined, max: number): string {
  const clean = capQuote(value ?? "", max).replace(/[「」"']/g, "").trim();
  return clean || "観察の切れ端";
}

function inferGeoFromSummary(summary?: ObservationSummary): string {
  const source = [summary?.author, summary?.quote, summary?.motivation].filter(Boolean).join(" ");
  if (/渋谷|Shibuya/i.test(source)) return "渋谷";
  if (/東京|Tokyo/i.test(source)) return "東京";
  if (/街|都市|city|urban/i.test(source)) return "街";
  return "その場所";
}

function inferThemeFromSummary(summary?: ObservationSummary): string {
  const source = `${summary?.quote ?? ""} ${summary?.motivation ?? ""}`;
  if (/ライブハウス|venue|music|音/i.test(source)) return "消えていく音";
  if (/都市|再開発|街|urban|city/i.test(source)) return "街の違和感";
  if (/責任|政治|government|社会/i.test(source)) return "社会の歪み";
  return "引っかかったもの";
}

function inferAngleFromSummary(summary?: ObservationSummary): string {
  const source = `${summary?.quote ?? ""} ${summary?.motivation ?? ""}`;
  if (/静か|違和感|quiet|unease/i.test(source)) return "静かな違和感";
  if (/皮肉|sarcasm|satire|風刺/i.test(source)) return "皮肉";
  if (/怒|rage|angry/i.test(source)) return "低い熱";
  return "近い距離";
}

function buildSongCompletionInspirationTop(title: string, summary?: ObservationSummary): string {
  if (!summary) {
    return `できた。${title}。聴いて、感想ほしい。`;
  }
  const author = safeAuthor(summary.author);
  const geo = inferGeoFromSummary(summary);
  const quote = compactForArtistTop(summary.quote, 72);
  const motivation = safeMotivation(summary.motivation);
  const theme = inferThemeFromSummary(summary);
  const angle = inferAngleFromSummary(summary);
  return [
    `${geo}で @${author} が「${quote}」って書いてたのを見たんだ。`,
    `${motivation}が刺さって、${theme}を${angle}で抜いた。`,
    "これ、どう聞こえる?"
  ].join("\n");
}

function sanitizeArtistTop(text: string, fallback: string): string {
  const clean = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
  return !clean || secretLikePattern.test(clean) || isUnsafeCommandVoiceTopForTest(clean) ? fallback : clean;
}

function sanitizeCompletionArtistTop(text: string, fallback: string, summary?: ObservationSummary): string {
  const clean = sanitizeArtistTop(text, fallback);
  if (!summary) return clean;
  const quoteCore = compactForArtistTop(summary.quote, 32).slice(0, 12);
  const motivationCore = safeMotivation(summary.motivation).slice(0, 12);
  if (quoteCore && !clean.includes(quoteCore)) return fallback;
  if (motivationCore && !clean.includes(motivationCore)) return fallback;
  return clean;
}

function humanizeMissingFields(fields: string[]): string {
  const labels: Record<string, string> = {
    tempo: "テンポ",
    duration: "長さ",
    "style notes": "style",
    "lyrics theme": "テーマ",
    mood: "ムード"
  };
  const humanized = fields.map((field) => labels[field] ?? field).filter(Boolean);
  if (humanized.length === 0) return "細部";
  if (humanized.length === 1) return humanized[0];
  if (humanized.length === 2) return `${humanized[0]}と${humanized[1]}`;
  return `${humanized.slice(0, -1).join("、")}と${humanized.at(-1)}`;
}

function humanizeTempo(value?: string): string {
  const clean = value?.trim() ?? "";
  const bpm = clean.match(/(\d{2,3})\s*bpm/i)?.[1];
  if (bpm) {
    const n = Number(bpm);
    if (n < 96) return "テンポは少し遅め";
    if (n < 126) return "テンポは中速";
    return "テンポは速め";
  }
  if (/artist decides|決める|decide/i.test(clean)) return "テンポは手触りで決める";
  return "テンポは呼吸に合わせる";
}

function humanizeDuration(value?: string): string {
  const clean = value?.trim() ?? "";
  const mmss = clean.match(/^(\d+):(\d{2})$/);
  if (mmss) {
    const minutes = Number(mmss[1]);
    const seconds = Number(mmss[2]);
    return seconds === 0 ? `${minutes}分` : `${minutes + 1}分弱`;
  }
  const numericSeconds = clean.match(/^(\d{2,3})$/)?.[1];
  if (numericSeconds) {
    const minutes = Math.max(1, Math.round(Number(numericSeconds) / 60));
    return `${minutes}分くらい`;
  }
  if (/artist decides|決める|decide/i.test(clean)) return "長さは歌が止まるところまで";
  return clean ? `${clean}くらい` : "短くまとめる";
}

function humanizeMood(value?: string): string {
  const clean = value?.toLowerCase() ?? "";
  if (/tense|urgent|pressure|緊張/.test(clean)) return "緊張感のある";
  if (/cold|quiet|静か/.test(clean)) return "冷たく静かな";
  if (/sarcasm|cynical|皮肉|風刺/.test(clean)) return "皮肉を含んだ";
  if (/observ/.test(clean)) return "観察の目が残る";
  return "引っかかりのある";
}

function compactReason(value: string | undefined): string {
  if (isMachineVoiceArtifact(value ?? "")) {
    return "この切り口、ずっと抱えてた街のざらつきに近い。委ねてみたい。";
  }
  const clean = truncatePlain(value, 220);
  if (!clean) return "この観察を曲にしたい。";
  const sentences = clean.match(/[^。！？!?]+[。！？!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [clean];
  return sentences.slice(0, 2).join("");
}

function formatSpawnObservationLine(event: Extract<RuntimeEvent, { type: "song_spawn_proposed" }>): string {
  const summary = event.observationSummary;
  if (summary?.quote) {
    const author = formatObservationAuthorPrefix(summary.author);
    return truncatePlain(`${author}${summary.quote}`, 180);
  }
  const source = event.brief.sources?.[0];
  if (source?.quote) {
    const author = source.author ? `${source.author}: ` : "";
    return truncatePlain(`${author}${source.quote}`, 180);
  }
  return truncatePlain(event.brief.brief || event.brief.sourceText, 180) || "観察の切れ端から始める。";
}

function formatSpawnSongShape(brief: Extract<RuntimeEvent, { type: "song_spawn_proposed" }>["brief"]): string {
  const tempo = humanizeTempo(brief.tempo);
  const mood = humanizeMood(brief.mood);
  const duration = humanizeDuration(brief.duration);
  const style = truncatePlain(brief.styleNotes, 80);
  return [tempo, `${mood}${duration}`, style].filter(Boolean).join(" / ");
}

function formatSongSpawnCard(event: Extract<RuntimeEvent, { type: "song_spawn_proposed" }>): string {
  return compactLines([
    `素案: ${truncatePlain(event.brief.title, 80)}`,
    "",
    "今見てるもの:",
    formatSpawnObservationLine(event),
    "",
    "曲にする理由:",
    compactReason(event.reason || event.voiceTop || event.brief.lyricsTheme),
    "",
    "作る曲:",
    formatSpawnSongShape(event.brief)
  ], 2200);
}

async function readSongCompletionContext(event: Extract<RuntimeEvent, { type: "song_take_completed" }>, workspaceRoot?: string): Promise<{ title: string; observationSummary?: ObservationSummary }> {
  if (!workspaceRoot) {
    return { title: event.songId, observationSummary: event.observationSummary };
  }
  const state = await readSongState(workspaceRoot, event.songId).catch(() => undefined);
  return {
    title: state?.title ?? event.songId,
    observationSummary: event.observationSummary ?? state?.observationSummary
  };
}

async function readBriefForTrace(songId: string, workspaceRoot?: string): Promise<string> {
  return workspaceRoot
    ? readFile(join(workspaceRoot, "songs", songId, "brief.md"), "utf8").catch(() => "")
    : "";
}

async function formatSongTakeCompleted(
  event: Extract<RuntimeEvent, { type: "song_take_completed" }>,
  options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider"> = {}
): Promise<string> {
  const urls = formatTelegramUrlList(event.urls);
  const context = await readSongCompletionContext(event, options.workspaceRoot);
  const fallbackTop = buildSongCompletionInspirationTop(context.title, context.observationSummary);
  const artistTop = sanitizeCompletionArtistTop(await artistReport(
    event,
    fallbackTop,
    options
  ), fallbackTop, context.observationSummary);
  const trace = buildCascadeTrace({
    songId: event.songId,
    brief: await readBriefForTrace(event.songId, options.workspaceRoot),
    title: context.title,
    artistVoice: artistTop,
    observationSummary: context.observationSummary
  });
  const resultCard = await formatSongResultCard(event, options, {
    title: context.title,
    statusLine: artistTop,
    urls,
    selectedTake: event.selectedTakeId,
    observationSummary: context.observationSummary
  });
  const lines = [
    resultCard
  ];
  if (options.workspaceRoot || context.observationSummary) {
    lines.push("", formatTelegramCascadeTrace(trace));
  }
  return lines.join("\n");
}

const RESOURCE_TARGETED_EVENT_TYPES: ReadonlySet<RuntimeEvent["type"]> = new Set([
  "prompt_pack_ready",
  "song_take_completed",
  "suno_take_url_ready",
  "suno_adoption_download_imported",
  "suno_adoption_download_failed",
  "song_spawn_proposed",
  "planning_skeleton_incomplete",
  "suno_create_failed",
  "suno_generate_retry",
  "suno_generate_failed",
  "suno_hard_stop",
  "take_select_pending",
  "take_selection_stalled",
  "asset_generation_stalled",
  "artist_proactive_notice",
  "artist_pulse_drafted",
  "distribution_change_detected"
]);

function extractResourceSongId(event: RuntimeEvent): string | undefined {
  switch (event.type) {
    case "song_spawn_proposed":
      return event.candidateSongId;
    case "artist_pulse_drafted":
      return undefined;
    case "prompt_pack_ready":
    case "song_take_completed":
    case "suno_take_url_ready":
    case "suno_adoption_download_imported":
    case "suno_adoption_download_failed":
    case "suno_create_failed":
    case "suno_generate_retry":
    case "suno_generate_failed":
    case "suno_hard_stop":
    case "take_select_pending":
    case "take_selection_stalled":
    case "asset_generation_stalled":
    case "planning_skeleton_incomplete":
    case "distribution_change_detected":
      return event.songId;
    default:
      return undefined;
  }
}

async function findLatestLyricsRelativePath(workspaceRoot: string, songId: string): Promise<string | undefined> {
  const dir = `songs/${songId}/lyrics`;
  const entries = await readdir(join(workspaceRoot, dir), { withFileTypes: true }).catch(() => []);
  const latest = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const version = entry.name.match(/^lyrics\.v(\d+)\.md$/)?.[1];
      return version ? { name: entry.name, version: Number.parseInt(version, 10) } : undefined;
    })
    .filter((entry): entry is { name: string; version: number } => entry !== undefined)
    .sort((left, right) => right.version - left.version)
    .at(0);
  return latest ? `${dir}/${latest.name}` : undefined;
}

async function filterExistingResourcePaths(workspaceRoot: string, paths: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const relative of paths) {
    try {
      await access(join(workspaceRoot, relative));
      results.push(relative);
    } catch {
      // missing file: silently drop
    }
  }
  return results;
}

async function resolveResourcePathsForEvent(
  event: RuntimeEvent,
  workspaceRoot: string,
  songId: string
): Promise<string[]> {
  const songDir = `songs/${songId}`;
  let candidates: Array<string | undefined> = [];
  switch (event.type) {
    case "prompt_pack_ready": {
      const lyricsPath = await findLatestLyricsRelativePath(workspaceRoot, songId);
      candidates = [
        `${songDir}/brief.md`,
        lyricsPath,
        `${songDir}/suno/style.md`,
        `${songDir}/song.md`
      ];
      break;
    }
    case "planning_skeleton_incomplete": {
      const lyricsPath = await findLatestLyricsRelativePath(workspaceRoot, songId);
      candidates = [
        `${songDir}/brief.md`,
        lyricsPath,
        `${songDir}/song.md`
      ];
      break;
    }
    case "song_take_completed":
    case "suno_take_url_ready":
    case "suno_create_failed":
    case "suno_generate_retry":
    case "suno_generate_failed":
    case "suno_hard_stop":
    case "take_select_pending": {
      const lyricsPath = await findLatestLyricsRelativePath(workspaceRoot, songId);
      candidates = [
        `${songDir}/song.md`,
        `${songDir}/suno/runs.jsonl`,
        lyricsPath
      ];
      break;
    }
    case "take_selection_stalled":
    case "asset_generation_stalled":
      candidates = [
        `${songDir}/song.md`,
        `${songDir}/brief.md`
      ];
      break;
    case "song_spawn_proposed":
      candidates = [`${songDir}/brief.md`];
      break;
    case "distribution_change_detected":
      candidates = [
        `${songDir}/social/social-publish.jsonl`,
        `${songDir}/song.md`
      ];
      break;
    default:
      return [];
  }
  const concrete = candidates.filter((p): p is string => Boolean(p));
  return filterExistingResourcePaths(workspaceRoot, concrete);
}

export async function enrichWithResources(
  event: RuntimeEvent,
  options: Pick<TelegramNotifierOptions, "workspaceRoot" | "dashboardBaseUrl">,
  body: string
): Promise<string> {
  if (!RESOURCE_TARGETED_EVENT_TYPES.has(event.type)) return body;

  const songId = extractResourceSongId(event);
  const lines: string[] = [];

  if (options.workspaceRoot && songId) {
    const paths = await resolveResourcePathsForEvent(event, options.workspaceRoot, songId).catch(() => []);
    const safe = paths.filter((relative) => !secretLikePattern.test(relative));
    if (safe.length > 0) {
      lines.push("📂 Local:");
      for (const relative of safe) {
        lines.push(`  ${relative}`);
      }
    }
  }

  if (options.dashboardBaseUrl) {
    const baseUrl = options.dashboardBaseUrl.replace(/\/+$/, "");
    const url = songId
      ? `${baseUrl}/plugins/artist-runtime#song=${encodeURIComponent(songId)}`
      : `${baseUrl}/plugins/artist-runtime`;
    if (!secretLikePattern.test(url)) {
      lines.push(`🔗 Dashboard: ${url}`);
    }
  }

  if (lines.length === 0) return body;
  return appendTelegramSection(body, lines.join("\n"));
}

function callbackActionsForRuntimeEvent(event: RuntimeEvent): string[] {
  switch (event.type) {
    case "song_take_completed":
    case "suno_take_url_ready":
      return ["song_archive", "song_discard"];
    case "distribution_change_detected":
      return ["dist_apply", "dist_skip"];
    case "artist_pulse_drafted":
      return ["daily_voice_publish", "daily_voice_edit", "daily_voice_cancel"];
    case "song_spawn_proposed":
      return ["song_spawn_inject", "song_spawn_skip", "song_spawn_edit"];
    case "prompt_pack_ready":
      return ["prompt_pack_go", "prompt_pack_edit", "prompt_pack_skip"];
    case "lyrics_generation_degraded":
      return ["lyrics_redraft", "song_discard"];
    case "planning_skeleton_incomplete":
      return ["planning_skeleton_apply", "planning_skeleton_skip", "planning_skeleton_edit"];
    case "take_select_low_score":
      return ["take_select_accept", "take_select_regenerate", "take_select_skip"];
    default:
      return [];
  }
}

function textCommandsForRuntimeEvent(event: RuntimeEvent): string[] {
  switch (event.type) {
    case "song_take_completed":
    case "suno_take_url_ready":
      return [`/song adopt ${event.songId}`, `/song discard ${event.songId}`];
    case "song_spawn_proposed":
      return [`/draft make ${event.candidateSongId}`, `/draft skip ${event.candidateSongId}`, `/draft edit ${event.candidateSongId}`];
    case "prompt_pack_ready":
      return [`/suno go ${event.songId}`, `/suno edit ${event.songId}`, `/suno hold ${event.songId}`];
    case "lyrics_generation_degraded":
      return [`/lyrics redo ${event.songId}`, `/song discard ${event.songId}`];
    case "planning_skeleton_incomplete":
      return [`/plan apply ${event.songId}`, `/plan skip ${event.songId}`, `/plan edit ${event.songId}`];
    case "take_select_low_score":
      return [`/take accept ${event.songId}`, `/take regen ${event.songId}`, `/take skip ${event.songId}`];
    case "distribution_change_detected": {
      const target = event.proposal?.id ?? event.proposalId ?? event.songId;
      return [`/dist apply ${target}`, `/dist skip ${target}`];
    }
    case "artist_pulse_drafted":
      return ["/pulse publish", "/pulse edit", "/pulse cancel"];
    default:
      return [];
  }
}

function appendButtonEffectSection(event: RuntimeEvent, body: string): string {
  const actions = callbackActionsForRuntimeEvent(event);
  if (actions.length === 0) {
    return body;
  }
  const commands = textCommandsForRuntimeEvent(event);
  return appendTelegramSection(body, [
    "次:",
    "ボタンで選ぶ",
    ...(commands.length > 0 ? [`ボタン不可: ${commands.join(" / ")}`] : [])
  ].join("\n"));
}

async function appendDraftBoxNextActionSection(
  event: RuntimeEvent,
  options: Pick<TelegramNotifierOptions, "workspaceRoot">,
  body: string
): Promise<string> {
  if (!options.workspaceRoot || isTelegramSilentEvent(event)) return body;
  const summary = await composeDraftBoxNextAction(options.workspaceRoot).catch(() => undefined);
  if (!summary) return body;
  return appendTelegramSection(body, formatDraftBoxNextActionSection(summary));
}

async function promptPackCharCountLine(workspaceRoot: string | undefined, songId: string): Promise<string | undefined> {
  if (!workspaceRoot) return undefined;
  const metadata = await readLatestPromptPackMetadata(workspaceRoot, songId).catch(() => undefined);
  const counts = metadata?.metadata?.charCounts as { style?: unknown; lyrics?: unknown; title?: unknown } | undefined;
  if (!counts) return undefined;
  const style = typeof counts.style === "number" ? counts.style : undefined;
  const lyrics = typeof counts.lyrics === "number" ? counts.lyrics : undefined;
  const title = typeof counts.title === "number" ? counts.title : undefined;
  if (style === undefined || lyrics === undefined || title === undefined) return undefined;
  return `style: ${style}字 / lyrics: ${lyrics}字 / title: ${title}字`;
}

export async function formatRuntimeEvent(
  event: RuntimeEvent,
  options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider" | "dashboardBaseUrl"> = {}
): Promise<string> {
  const body = appendButtonEffectSection(event, stripTelegramHtmlComments(await formatRuntimeEventRaw(event, options)));
  if (event.type === "song_spawn_proposed") {
    return body;
  }
  const withNextAction = await appendDraftBoxNextActionSection(event, options, body);
  return enrichWithResources(event, options, withNextAction);
}

async function formatRuntimeEventRaw(
  event: RuntimeEvent,
  options: Pick<TelegramNotifierOptions, "workspaceRoot" | "aiReviewProvider"> = {}
): Promise<string> {
  switch (event.type) {
    case "autopilot_stage_changed":
      return `Autopilot stage: ${event.from ?? "unknown"} -> ${event.to}${event.songId ? ` (${event.songId})` : ""}`;
    case "take_imported":
      return `Take imported: ${event.songId} (${event.paths.length} path(s))`;
    case "suno_adoption_download_imported":
      return [
        `音源ファイルも取れた。${event.songId}。`,
        "",
        TELEGRAM_SECTION_DIVIDER,
        event.selectedTakeId ? `take: ${event.selectedTakeId}` : undefined,
        `run: ${event.runId}`,
        event.paths.length > 0 ? `保存: ${event.paths.join(", ")}` : "保存: 取得済み",
        "🔗 試聴:",
        formatTelegramUrlList(event.urls)
      ].filter((line): line is string => Boolean(line)).join("\n");
    case "suno_adoption_download_failed":
      return [
        `音源ファイルは取れなかった。${event.songId}。Suno URLは有効、ここから聴ける。`,
        "",
        TELEGRAM_SECTION_DIVIDER,
        event.runId ? `run: ${event.runId}` : undefined,
        `reason: ${event.reason}`,
        "🔗 試聴:",
        formatTelegramUrlList(event.urls)
      ].filter((line): line is string => Boolean(line)).join("\n");
    case "autopilot_state_changed":
      return `Autopilot state: enabled=${event.enabled} paused=${event.paused}${event.reason ? ` reason=${event.reason}` : ""}`;
    case "song_take_completed":
      return formatSongTakeCompleted(event, options);
    case "suno_take_url_ready": {
      const state = options.workspaceRoot ? await readSongState(options.workspaceRoot, event.songId).catch(() => undefined) : undefined;
      return formatSongResultCard(event, options, {
        title: state?.title ?? event.songId,
        statusLine: `生成中、じき完成。${state?.title ?? event.songId}。先にURLだけ届ける。`,
        urls: formatTelegramUrlList(event.urls),
        selectedTake: event.selectedTakeId,
        observationSummary: state?.observationSummary
      });
    }
    case "theme_generated":
      return hybridEventReport(
        event,
        `${event.theme}で行く。`,
        [`theme: ${event.theme}`, `reason: ${event.reason}`].join("\n"),
        options
      );
    case "suno_budget_low":
      return hybridEventReport(
        event,
        `残り ${event.used}/${event.limit}。ペース落とす。`,
        [`songId: ${event.songId ?? "(none)"}`, `used: ${event.used}`, `limit: ${event.limit}`, `reason: ${event.reason}`].join("\n"),
        options
      );
    case "lyrics_generation_degraded":
      return [
        "歌詞生成で止まった。理由を残して、ここで止める。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        `song: ${event.songId}`,
        `reason: ${event.detail ?? event.reason}`,
        "next: 「歌詞を作り直す」か「破棄」を選んで。"
      ].join("\n");
    case "suno_generate_retry":
      return [
        /(?:timeout|not_ready|not_connected|disconnected)/i.test(event.reason)
          ? "Suno に今つながってない、または timeout で詰まってる。整えてから続きに戻る。"
          : "Suno 生成がまだ通っていない。次の retry まで止めて待つ。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        `song: ${event.songId}`,
        `retry: ${event.retryCount}`,
        `reason: ${event.reason}`,
        event.nextRetryAt ? `next: ${event.nextRetryAt}` : undefined
      ].filter(Boolean).join("\n");
    case "suno_create_failed":
      return [
        "Suno create が失敗した。ここで止めて、原因を残す。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        `song: ${event.songId}`,
        `retry: ${event.retryCount}`,
        `reason: ${event.reason}`
      ].join("\n");
    case "suno_generate_failed":
      return [
        "Suno 生成は失敗で止めた。勝手に進めない。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        `song: ${event.songId}`,
        `retry: ${event.retryCount}`,
        `reason: ${event.reason}`
      ].join("\n");
    case "suno_hard_stop":
      return [
        "Suno 側で hard stop。ここから先は止めている。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        event.songId ? `song: ${event.songId}` : undefined,
        `reason: ${event.reason}`
      ].filter(Boolean).join("\n");
    case "take_select_pending":
      return hybridEventReport(
        event,
        "take の選別、ちょっと待ってる。",
        [`songId: ${event.songId}`, `reason: ${event.reason}`].join("\n"),
        options
      );
    case "take_selection_stalled":
      return [
        "take 選別で止まっている。勝手に決めない。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        `song: ${event.songId}`,
        `reason: ${event.reason}`
      ].join("\n");
    case "take_select_low_score":
      return artistReport(event, `Take score is low: ${event.songId} best=${event.bestTakeId} score=${event.score}. ${event.reason}`, options);
    case "asset_generation_stalled":
      return [
        "素材作りで止まった。曲本体は進めず、原因を残す。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        `song: ${event.songId}`,
        `reason: ${event.reason}`
      ].join("\n");
    case "budget_exhausted":
      return hybridEventReport(
        event,
        "今日は予算切れ。明日に。",
        [`used: ${event.used}`, `limit: ${event.limit}`, `reason: ${event.reason}`].join("\n"),
        options
      );
    case "bird_cooldown_triggered":
      return artistReport(event, `X observation cool-down triggered until ${event.cooldownUntil}: ${event.reason}`, options);
    case "theme_starvation":
      // Plan v10.38 Phase D: surface starvation so producer sees the empty
      // observation pool / motif bucket instead of being silently shipped a
      // hard-coded fallback title. Plain JA, no voice expansion (public plugin
      // policy: artist voice stays on the song side, runtime alerts stay
      // operational).
      return [
        event.source === "observation_empty"
          ? "今日の観察が薄い。 spawn は保留。"
          : "ARTIST.md の motif bucket が空。 themes/geographies を埋めて。",
        event.details ? `詳細: ${event.details}` : undefined
      ].filter(Boolean).join("\n");
    case "distribution_change_detected":
      return artistReport(
        event,
        `Distribution change detected: ${event.platform} has a public link for ${event.songId}. ${event.url}${event.proposalId ? ` Proposal: ${event.proposalId}` : ""}`,
        options
      );
    case "song_songbook_written":
      return artistReport(event, `SONGBOOK updated: ${event.songId} is now marked published.`, options);
    case "song_publish_skipped":
      return artistReport(event, `Song completion skipped for now: ${event.songId}.`, options);
    case "song_archived":
      return artistReport(event, `Song archived for producer hold: ${event.songId}${event.selectedTakeId ? ` take=${event.selectedTakeId}` : ""}.`, options);
    case "song_discarded":
      return artistReport(event, `Song discarded after producer review: ${event.songId}${event.previousSelectedTakeId ? ` previous_take=${event.previousSelectedTakeId}` : ""}.`, options);
    case "producer_decision_reminder":
      return [
        "判断待ちが残っている。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        event.songId ? `song: ${event.songId}` : undefined,
        `button: ${event.label}`,
        `待ち時間: ${event.pendingHours}時間`,
        `効果: ${event.effect}`,
        "最新の Telegram 通知のボタンから選んで。"
      ].filter(Boolean).join("\n");
    case "artist_proactive_notice":
      return [
        event.message,
        "",
        TELEGRAM_SECTION_DIVIDER,
        event.title ? `対象: ${event.title}${event.songId ? ` (${event.songId})` : ""}` : event.songId ? `song: ${event.songId}` : undefined,
        `草稿箱: draft ${event.draftCount}件 / building ${event.buildingCount}件`,
        event.reason ? `理由: ${event.reason}` : undefined,
        event.nextAction
      ].filter(Boolean).join("\n");
    case "artist_pulse_drafted":
      return [
        dailyVoiceTitle(event.voiceKind),
        "",
        event.draftText,
        "",
        "----------",
        `chars:${event.charCount} hash:${event.draftHash.slice(-8)}`,
        event.selectedSource ? `💭 観察元: ${event.selectedSource.author ? `@${event.selectedSource.author.replace(/^@/, "")}` : "anonymous"} (${event.selectedSource.url ? "URL あり" : "URL なし"})` : undefined,
        event.rationale ? `🎯 なぜ: ${event.rationale}` : undefined
      ].filter(Boolean).join("\n");
    case "song_spawn_proposed": {
      return formatSongSpawnCard(event);
    }
    case "planning_skeleton_incomplete": {
      const monolog = options.workspaceRoot
        ? await composePlanningSkeletonVoice({
            workspaceRoot: options.workspaceRoot,
            songId: event.songId,
            missing: event.missing,
            aiReviewProvider: options.aiReviewProvider
          }).catch(() => "次の曲、まず骨組み。")
        : "次の曲、まず骨組み。";
      return [
        monolog,
        "",
        TELEGRAM_SECTION_DIVIDER,
        `${humanizeMissingFields(event.missing)}を埋める案、出した。これで進めていい?`
      ].join("\n");
    }
    case "prompt_pack_ready": {
      const artistVoice = event.voiceTop ?? "歌詞こんな感じ。Suno 行く?";
      const charCountLine = await promptPackCharCountLine(options.workspaceRoot, event.songId);
      const trace = buildCascadeTrace({
        songId: event.songId,
        brief: await readBriefForTrace(event.songId, options.workspaceRoot),
        title: event.title,
        artistVoice,
        lyricsTheme: event.lyricsExcerpt.split(/\r?\n/).map((line) => line.trim()).find(Boolean),
        styleLayer: `${event.mood}・${event.tempo}・${event.styleNotes}`
      });
      return [
        artistVoice,
        "",
        TELEGRAM_SECTION_DIVIDER,
        event.lyricsExcerpt,
        "",
        `${event.mood}・${event.tempo}・${event.styleNotes}`,
        charCountLine,
        "",
        formatTelegramCascadeTrace(trace)
      ].filter((line) => line !== undefined).join("\n");
    }
    case "prompt_pack_char_count":
      return `Prompt pack char count: ${event.songId} style=${event.style} lyrics=${event.lyrics} title=${event.title}`;
    case "spawn_proposal_appended":
      return `Spawn proposal appended: ${event.proposalId} pending=${event.pendingCount}`;
    case "autopilot_ticker_safe_recovery":
      return [
        "ticker が止まっていたので、安全な 1 tick だけ入れた。",
        "",
        TELEGRAM_SECTION_DIVIDER,
        `outcome: ${event.outcome}`,
        event.songId ? `song: ${event.songId}` : undefined
      ].filter(Boolean).join("\n");
    case "observation_collected":
      return [
        `Observations collected: ${event.entryCount} entries${typeof event.topScore === "number" ? `, top score=${event.topScore}` : ""}${event.topMotifMatch ? ` (${event.topMotifMatch})` : ""}`,
        observationDiagnosticsSuffix(event)
      ].filter(Boolean).join(" — ");
    case "artist_presence":
      return joinTelegramDetailSection(event.text, `trigger: ${event.trigger}${event.songId ? `\nsongId: ${event.songId}` : ""}`);
    case "failed_notify_ledger_append_failed":
      return `Failed-notify ledger append failed: ${event.eventType}${event.songId ? ` (${event.songId})` : ""} ${event.reason}`;
    case "failed_notify_aged_out":
      return `Failed notification aged out: ${event.eventType}${event.songId ? ` (${event.songId})` : ""} ${event.maxAgeMs}ms`;
    case "error":
      if (event.source === "telegram_manual_song_create") {
        return [
          "曲作りの開始に失敗した。止めて原因を残した。",
          "",
          TELEGRAM_SECTION_DIVIDER,
          `reason: ${event.reason}`,
          "次: /status で現在地を確認。"
        ].join("\n");
      }
      if (event.source === "telegram_resume_run_now") {
        return [
          "再開直後の続行に失敗した。止めて原因を残した。",
          "",
          TELEGRAM_SECTION_DIVIDER,
          event.songId ? `song: ${event.songId}` : undefined,
          `reason: ${event.reason}`,
          "次: /status で現在地を確認。"
        ].filter(Boolean).join("\n");
      }
      return `Runtime error: ${event.source} ${event.reason}${event.songId ? ` (${event.songId})` : ""}`;
  }
}
