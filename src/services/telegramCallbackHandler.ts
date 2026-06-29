import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { isResurfaceAllowedAction, markCallbackResolved, markSiblingCallbacksResolved, registerCallbackAction, resolveCallbackAction, type CallbackActionEntry, type CallbackActionStatus } from "./callbackActionRegistry.js";
import { readSongState, updateSongState } from "./artistState.js";
import { applyChangeSet } from "./changeSetApplier.js";
import { handleProposalResponse } from "./conversationalSession.js";
import type { ChangeSetProposal } from "./freeformChangesetProposer.js";
import { secretLikePattern } from "./personaMigrator.js";
import { isArtistPulseEnabled, isSongSpawnEnabled, isXInlineButtonEnabled } from "./runtimeConfig.js";
import { injectCommissionSong } from "./songStateInjector.js";
import { markSpawned } from "./songSpawnRateLimiter.js";
import { readAutopilotRunState, writeAutopilotRunState } from "./autopilotService.js";
import { getAutopilotTicker } from "./autopilotTicker.js";
import { handleSongPublishActionRequest, type SongPublishAction } from "./songPublishActionRegistry.js";
import { markSpawnProposalBuilding, markSpawnProposalDismissed } from "./spawnProposalQueue.js";
import { resurfacePromptPackReady } from "./promptPackResurfaceService.js";
import { selectTake } from "./takeSelection.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import type { TelegramClient } from "./telegramClient.js";
import { executeXPublishAction, type XPublishActionInput } from "./xPublishActionRegistry.js";
import { stampCallback } from "./receiveHealthService.js";
import { scheduleDownloadAfterAdoptionJob } from "./sunoAdoptionDownloadJob.js";

export const STALE_CALLBACK_JA_REPLY = "このボタンはもう古い。 最新の通知から選び直して。";
const SONG_REVIEW_SIBLING_ACTIONS = new Set(["song_archive", "song_discard"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logCallbackDeliveryFailure(context: string, error: unknown): void {
  console.error(`[telegram-callback] ${context} failed: ${errorMessage(error)}`);
}

// Producer decisions are operator actions; without an immediate cycle the next
// pipeline move waits for the full ticker interval (default 3h) — the producer
// adopts a song and then stares at a silent Telegram for hours (2026-06-12).
// Mirror the v10.66 /resume kick: fire one operator-initiated cycle; every
// downstream gate (spawn GO, dryRun, Suno budget/live flags) re-applies inside
// runCycle, so this never bypasses an approval.
function kickAutopilotCycleAfterProducerDecision(context: string): void {
  void getAutopilotTicker().runNow().catch((error) => {
    console.error(`[telegram-callback] post-decision cycle kick (${context}) failed: ${errorMessage(error)}`);
  });
}

export interface TelegramCallbackContext {
  root: string;
  client: TelegramClient;
  callbackQueryId: string;
  data?: string;
  fromUserId: number;
  chatId?: number;
  messageId?: number;
  now?: number;
  actor?: "telegram_callback" | "internal_recovery" | "ui_api" | "watchdog_recovery" | "watchdog_reprompt" | "watchdog_expire";
  auditReason?: string;
  xPublishSpawnImpl?: XPublishActionInput["spawnImpl"];
}

export interface TelegramCallbackResult {
  processed: boolean;
  result: "ignored" | "expired" | "unauthorized" | "duplicate" | "failed" | "applied" | "discarded" | "updated" | "blocked";
  reason?: string;
  callbackId?: string;
}

interface CallbackAuditEntry {
  timestamp: number;
  callbackId?: string;
  action?: string;
  proposalId?: string;
  songId?: string;
  platform?: string;
  chatIdHash?: string;
  userIdHash?: string;
  result: TelegramCallbackResult["result"];
  reason?: string;
  draftHash?: string;
  draftCharCount?: number;
  tweetUrl?: string;
  birdStatus?: string;
  actor?: TelegramCallbackContext["actor"];
}

function auditPath(root: string): string {
  return join(root, "runtime", "callback-audit.jsonl");
}

function hashIdentifier(value: number | string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

async function appendCallbackAudit(root: string, entry: CallbackAuditEntry): Promise<void> {
  const path = auditPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function auditBase(
  ctx: TelegramCallbackContext,
  callbackId: string | undefined,
  entry: CallbackActionEntry | undefined,
  result: TelegramCallbackResult["result"],
  reason?: string,
  extra: Partial<Pick<CallbackAuditEntry, "draftHash" | "draftCharCount" | "tweetUrl" | "birdStatus">> = {}
): CallbackAuditEntry {
  return {
    timestamp: ctx.now ?? Date.now(),
    callbackId,
    action: entry?.action,
    proposalId: entry?.proposalId,
    songId: entry?.songId,
    platform: entry?.platform,
    chatIdHash: hashIdentifier(ctx.chatId),
    userIdHash: hashIdentifier(ctx.fromUserId),
    result,
    reason: ctx.auditReason ?? reason,
    actor: ctx.actor,
    ...extra
  };
}

function xPublishSongbookProposal(songId: string, tweetUrl: string, now: number): ChangeSetProposal {
  return {
    id: `x-publish-${songId}-${now.toString(36)}`,
    domain: "song",
    summary: `X post URL recorded for ${songId}.`,
    fields: [
      {
        domain: "song",
        targetFile: join("songs", songId, "song.md"),
        field: "status",
        proposedValue: "published",
        currentValue: "",
        reasoning: "X publish confirmed by producer inline button",
        status: "proposed"
      },
      {
        domain: "song",
        targetFile: join("artist", "SONGBOOK.md"),
        field: "publicLinksOther",
        proposedValue: tweetUrl,
        currentValue: "",
        reasoning: "X publish callback returned a tweet URL",
        status: "proposed"
      }
    ],
    warnings: [],
    createdAt: new Date(now).toISOString(),
    source: "conversation",
    songId,
    platform: "x"
  };
}

function xPreviewText(draftText: string, draftHash: string, draftCharCount: number): string {
  return [
    "X post preview:",
    "",
    draftText,
    "",
    `hash:${draftHash.slice(-8)} chars:${draftCharCount}`,
    "Tap publish only if this exact draft is OK."
  ].join("\n");
}

function isWatchdogActor(actor: TelegramCallbackContext["actor"]): boolean {
  return actor === "watchdog_recovery" || actor === "watchdog_reprompt" || actor === "watchdog_expire";
}

function isExternalPublishCallbackAction(action: string): boolean {
  return action === "daily_voice_publish" || action === "x_publish_confirm";
}

const LANE_RELEASED_SONG_STATUSES = new Set(["suno_take_url_ready", "scheduled", "published", "archived", "discarded", "failed"]);

async function markProposalStatusIfPresent(
  action: (root: string, proposalId: string) => Promise<unknown>,
  root: string,
  proposalId: string | undefined
): Promise<void> {
  if (!proposalId) return;
  await action(root, proposalId).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (!reason.startsWith("spawn_proposal_not_found:")) {
      throw error;
    }
  });
}

async function currentSongLaneBusy(root: string, state: Awaited<ReturnType<typeof readAutopilotRunState>>, proposalSongId: string): Promise<boolean> {
  const currentSongId = state.currentSongId;
  if (!currentSongId) return false;
  if (currentSongId === proposalSongId && state.suspendedAt === "spawn_proposal_ready") return false;
  const current = await readSongState(root, currentSongId).catch(() => undefined);
  if (!current) return false;
  return !LANE_RELEASED_SONG_STATUSES.has(current.status);
}

async function releaseDiscardedCurrentSongLane(root: string, songId: string | undefined, now: number): Promise<void> {
  if (!songId) return;
  const state = await readAutopilotRunState(root);
  if (state.currentSongId !== songId) return;
  await writeAutopilotRunState(root, {
    ...state,
    currentSongId: undefined,
    stage: "idle",
    paused: false,
    pausedReason: undefined,
    hardStopReason: undefined,
    suspendedAt: undefined,
    blockedReason: undefined,
    lastError: undefined,
    lastRunAt: new Date(now).toISOString()
  });
}

async function clearButtonsAndReply(
  ctx: TelegramCallbackContext,
  entry: Pick<CallbackActionEntry, "chatId" | "messageId">,
  message: string,
  options: { replyMarkup?: { inline_keyboard: { text: string; callback_data: string }[][] } } = {}
): Promise<void> {
  await ctx.client.editMessageReplyMarkup(entry.chatId, entry.messageId, { inline_keyboard: [] })
    .catch((error) => logCallbackDeliveryFailure("clear_buttons", error));
  await ctx.client.sendMessage(entry.chatId, message, options.replyMarkup ? { replyMarkup: options.replyMarkup } : undefined)
    .catch((error) => logCallbackDeliveryFailure("reply_message", error));
}

async function finish(
  ctx: TelegramCallbackContext,
  callbackId: string | undefined,
  entry: CallbackActionEntry | undefined,
  result: TelegramCallbackResult["result"],
  reason: string,
  ackText: string,
  status?: Exclude<CallbackActionStatus, "pending">
): Promise<TelegramCallbackResult> {
  await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: ackText });
  if (callbackId && status) {
    await markCallbackResolved(ctx.root, callbackId, { status, reason, now: ctx.now });
  }
  await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, result, reason));
  return { processed: true, result, reason, callbackId };
}

// Plan v10.56 self-recovery: terminal song states an expired producer-decision
// callback may NOT be re-surfaced into (the decision is already final there).
const TERMINAL_SONG_STATUSES_FOR_RESURFACE: ReadonlySet<string> = new Set([
  "scheduled", "published", "archived", "discarded", "failed"
]);

// Plan v10.56/10.57: a Telegram user tapping an expired/stale producer-decision
// button re-surfaces a FRESH notification (with a new live button) — NOT a re-run
// of the original action. This is UI re-issuance: it re-emits the owning event so
// the notifier's formatter produces the body + freshly-minted buttons.
// Guarded by isResurfaceAllowedAction (callers) + terminal-state + single-shot here.
async function resurfaceExpiredProducerDecision(
  ctx: TelegramCallbackContext,
  callbackId: string,
  entry: CallbackActionEntry,
  staleReason: string
): Promise<TelegramCallbackResult> {
  const now = ctx.now ?? Date.now();
  // multi-fire guard: if already re-surfaced once, point the user at the latest notice.
  if (entry.resolveReason && entry.resolveReason.includes("resurfaced")) {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "すでに再表示済みです。最新の通知から選んでください。" });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "duplicate", "resurface_already_done"));
    return { processed: true, result: "duplicate", reason: "resurface_already_done", callbackId };
  }
  // state-based: the song already moved on to a terminal state -> re-surface refused.
  if (entry.songId) {
    const song = await readSongState(ctx.root, entry.songId).catch(() => undefined);
    if (song && TERMINAL_SONG_STATUSES_FOR_RESURFACE.has(song.status)) {
      await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: `この曲はもう「${song.status}」です。再表示はできません。` });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "expired", `resurface_rejected_terminal:${song.status}`));
      return { processed: true, result: "expired", reason: `resurface_rejected_terminal:${song.status}`, callbackId };
    }
  }
  // spawn-proposal family: re-emit so the notifier re-issues narrative + fresh button.
  if (entry.commissionBrief && entry.action.startsWith("song_spawn_")) {
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", `callback_resurface_requested:${staleReason}`));
    emitRuntimeEvent({
      type: "song_spawn_proposed",
      brief: entry.commissionBrief,
      reason: entry.spawnReason ?? entry.commissionBrief.brief,
      candidateSongId: entry.songId ?? entry.proposalId ?? entry.commissionBrief.songId,
      timestamp: now
    });
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "最新の提案を再表示しました。届いた通知から選んでください。" });
    await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: `resurfaced:${staleReason}`, now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", "callback_resurfaced"));
    return { processed: true, result: "updated", reason: "callback_resurfaced", callbackId };
  }
  if (entry.action.startsWith("prompt_pack_") && entry.songId) {
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", `callback_resurface_requested:${staleReason}`));
    const resurface = await resurfacePromptPackReady(ctx.root, { songId: entry.songId, now });
    if (resurface.resurfaced) {
      await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "Suno 生成待ちを再表示しました。届いた通知から選んでください。" });
      await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: `resurfaced:${staleReason}`, now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", "callback_resurfaced"));
      return { processed: true, result: "updated", reason: "callback_resurfaced", callbackId };
    }
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "この曲は今、Suno 生成待ちではありません。" });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "expired", `resurface_rejected:${resurface.reason}`));
    return { processed: true, result: "expired", reason: `resurface_rejected:${resurface.reason}`, callbackId };
  }
  // allowed action but no re-emit path (e.g. archive/discard without a brief) -> graceful stale reply.
  await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: STALE_CALLBACK_JA_REPLY });
  await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "expired", `${staleReason}:resurface_unsupported`));
  return { processed: true, result: "expired", reason: `${staleReason}:resurface_unsupported`, callbackId };
}

export async function routeTelegramCallback(ctx: TelegramCallbackContext): Promise<TelegramCallbackResult> {
  const data = ctx.data ?? "";
  // Plan v10.65 Layer 1: record that a callback_query physically reached the
  // plugin handler (records receive regardless of authorization/expiry outcome).
  await stampCallback(ctx.root, ctx.now ?? Date.now());
  if (secretLikePattern.test(data)) {
    return finish(ctx, undefined, undefined, "failed", "callback_data_contains_secret_like_text", "Unsupported action", "failed");
  }
  if (!data.startsWith("cb:")) {
    await appendCallbackAudit(ctx.root, auditBase(ctx, undefined, undefined, "ignored", "unsupported_callback_data"));
    return { processed: false, result: "ignored", reason: "unsupported_callback_data" };
  }

  const callbackId = data.slice(3);
  const entry = await resolveCallbackAction(ctx.root, callbackId);
  if (!entry) {
    return finish(ctx, callbackId, undefined, "expired", "unknown_callback_blocked", STALE_CALLBACK_JA_REPLY, "expired");
  }
  if (ctx.fromUserId !== entry.userId || ctx.chatId !== entry.chatId || ctx.messageId !== entry.messageId) {
    return finish(ctx, callbackId, entry, "unauthorized", "callback_owner_or_message_mismatch", "Not authorized", "unauthorized");
  }
  const now = ctx.now ?? Date.now();
  if (now > entry.expiresAt) {
    if (isResurfaceAllowedAction(entry.action)) {
      return resurfaceExpiredProducerDecision(ctx, callbackId, entry, "callback_action_expired");
    }
    return finish(ctx, callbackId, entry, "expired", "callback_action_expired", "Expired", "expired");
  }
  if (entry.status !== "pending") {
    // Plan v10.56: a producer-decision callback wrongly/legitimately left "expired"
    // (e.g. stale-queue maintenance) can be re-surfaced by the user from Telegram.
    if (entry.status === "expired" && isResurfaceAllowedAction(entry.action)) {
      return resurfaceExpiredProducerDecision(ctx, callbackId, entry, `stale_${entry.status}`);
    }
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "Already resolved" });
    await markCallbackResolved(ctx.root, callbackId, { status: "duplicate", reason: `already_${entry.status}`, now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "duplicate", `already_${entry.status}`));
    return { processed: true, result: "duplicate", reason: `already_${entry.status}`, callbackId };
  }
  if (isWatchdogActor(ctx.actor) && isExternalPublishCallbackAction(entry.action)) {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "Blocked" })
      .catch((error) => logCallbackDeliveryFailure("watchdog_publish_guard_answer", error));
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "blocked", "external_publish_actor_guard"));
    return { processed: true, result: "blocked", reason: "external_publish_actor_guard", callbackId };
  }

  if (entry.action === "proposal_yes" || entry.action === "proposal_no" || entry.action === "dist_apply" || entry.action === "dist_skip") {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    const isApply = entry.action === "proposal_yes" || entry.action === "dist_apply";
    const proposalResult = await handleProposalResponse(ctx.root, {
      proposalId: entry.proposalId ?? "",
      action: isApply ? "yes" : "no",
      actor: { kind: "telegram_callback", chatId: entry.chatId, userId: entry.userId },
      now
    });
    const callbackStatus: Exclude<CallbackActionStatus, "pending"> =
      proposalResult.status === "applied" ? "applied"
        : proposalResult.status === "discarded" ? "discarded"
          : proposalResult.status === "already_resolved" ? "duplicate"
            : "failed";
    await markCallbackResolved(ctx.root, callbackId, { status: callbackStatus, reason: proposalResult.status, now });
    const callbackResult: TelegramCallbackResult["result"] =
      callbackStatus === "applied" ? "applied"
        : callbackStatus === "discarded" ? "discarded"
          : callbackStatus === "duplicate" ? "duplicate"
            : "failed";
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, callbackResult, proposalResult.status));
    const message = entry.action.startsWith("dist_")
      ? `${proposalResult.status === "applied" ? "Applied ✓" : proposalResult.status === "discarded" ? "Skipped" : "Already resolved"}${entry.platform ? ` ${entry.platform}` : ""}${entry.songId ? ` for ${entry.songId}` : ""}. ${proposalResult.message}`
      : proposalResult.message;
    await clearButtonsAndReply(ctx, entry, message);
    return { processed: true, result: callbackResult, reason: proposalResult.status, callbackId };
  }

  if (entry.action === "proposal_edit_open") {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    const proposalResult = await handleProposalResponse(ctx.root, {
      proposalId: entry.proposalId ?? "",
      action: "edit",
      actor: { kind: "telegram_callback", chatId: entry.chatId, userId: entry.userId },
      now
    });
    await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: "edit_opened", now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", proposalResult.status));
    await ctx.client.sendMessage(entry.chatId, "Edit dialog opened. Send /edit <field> <value>, or use Producer Console to adjust fields.")
      .catch((error) => logCallbackDeliveryFailure("proposal_edit_open_message", error));
    await ctx.client.editMessageReplyMarkup(entry.chatId, entry.messageId, { inline_keyboard: [] })
      .catch((error) => logCallbackDeliveryFailure("proposal_edit_open_clear_buttons", error));
    return { processed: true, result: "updated", reason: proposalResult.status, callbackId };
  }

  if (entry.action === "song_songbook_write" || entry.action === "song_skip" || entry.action === "song_archive" || entry.action === "song_discard") {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    try {
      const previousSong = entry.songId ? await readSongState(ctx.root, entry.songId).catch(() => undefined) : undefined;
      const actionResult = await handleSongPublishActionRequest({
        action: entry.action as SongPublishAction,
        root: ctx.root,
        songId: entry.songId ?? "",
        now,
        actor: { kind: "telegram_callback", chatId: entry.chatId, userId: entry.userId }
      });
      const callbackStatus: Exclude<CallbackActionStatus, "pending"> = actionResult.status === "applied" ? "applied" : "discarded";
      const callbackResult: TelegramCallbackResult["result"] = actionResult.status === "applied" ? "applied" : "discarded";
      const auditReason = actionResult.reason ?? actionResult.status;
      await markCallbackResolved(ctx.root, callbackId, { status: callbackStatus, reason: auditReason, now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, callbackResult, auditReason));
      if ((entry.action === "song_archive" || entry.action === "song_discard") && entry.songId) {
        await markSiblingCallbacksResolved(ctx.root, entry, {
          status: "discarded",
          reason: `sibling_resolved_by:${entry.action}`,
          now,
          actions: SONG_REVIEW_SIBLING_ACTIONS
        });
      }
      if (entry.action === "song_archive" && actionResult.status === "applied" && previousSong?.status === "suno_take_url_ready" && entry.songId) {
        await scheduleDownloadAfterAdoptionJob({
          root: ctx.root,
          songId: entry.songId,
          chatId: entry.chatId,
          client: ctx.client,
          now
        });
      }
      if (entry.action === "song_discard") {
        await releaseDiscardedCurrentSongLane(ctx.root, entry.songId, now);
      }
      await clearButtonsAndReply(ctx, entry, actionResult.message);
      kickAutopilotCycleAfterProducerDecision(entry.action);
      return { processed: true, result: callbackResult, reason: auditReason, callbackId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "song_publish_action_failed";
      await markCallbackResolved(ctx.root, callbackId, { status: "failed", reason, now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "failed", reason));
      await clearButtonsAndReply(ctx, entry, "Song action failed. Check the runtime log.");
      return { processed: true, result: "failed", reason, callbackId };
    }
  }

  if (entry.action === "daily_voice_publish" || entry.action === "daily_voice_edit" || entry.action === "daily_voice_cancel") {
    if (!isArtistPulseEnabled()) {
      return finish(ctx, callbackId, entry, "failed", "artist_pulse_disabled", "Artist pulse disabled", "failed");
    }
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    if (entry.action === "daily_voice_cancel") {
      await markCallbackResolved(ctx.root, callbackId, { status: "discarded", reason: "daily_voice_cancelled", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "discarded", "daily_voice_cancelled", {
        draftHash: entry.draftHash,
        draftCharCount: entry.draftCharCount
      }));
      await clearButtonsAndReply(ctx, entry, "普段の投稿は取り消した。");
      return { processed: true, result: "discarded", reason: "daily_voice_cancelled", callbackId };
    }
    if (entry.action === "daily_voice_edit") {
      await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: "daily_voice_edit_requested", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", "daily_voice_edit_requested", {
        draftHash: entry.draftHash,
        draftCharCount: entry.draftCharCount
      }));
      await ctx.client.sendMessage(entry.chatId, "直すなら、今の文面を踏まえて普通に返信してくれ。callback に本文は載せない。")
        .catch((error) => logCallbackDeliveryFailure("daily_voice_edit_message", error));
      await ctx.client.editMessageReplyMarkup(entry.chatId, entry.messageId, { inline_keyboard: [] })
        .catch((error) => logCallbackDeliveryFailure("daily_voice_edit_clear_buttons", error));
      return { processed: true, result: "updated", reason: "daily_voice_edit_requested", callbackId };
    }
    const published = await executeXPublishAction({
      root: ctx.root,
      songId: "",
      action: "daily_voice_publish",
      actor: ctx.actor,
      entry,
      spawnImpl: ctx.xPublishSpawnImpl
    });
    if (published.status !== "published" || !published.tweetUrl) {
      await markCallbackResolved(ctx.root, callbackId, { status: "failed", reason: published.reason ?? published.status, now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "failed", published.reason ?? published.status, {
        draftHash: entry.draftHash,
        draftCharCount: entry.draftCharCount,
        birdStatus: published.birdStatus
      }));
      await clearButtonsAndReply(ctx, entry, `X投稿に失敗: ${published.reason ?? published.status}`);
      return { processed: true, result: "failed", reason: published.reason ?? published.status, callbackId };
    }
    await markCallbackResolved(ctx.root, callbackId, { status: "applied", reason: "daily_voice_published", now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "applied", "daily_voice_published", {
      draftHash: entry.draftHash,
      draftCharCount: entry.draftCharCount,
      tweetUrl: published.tweetUrl,
      birdStatus: published.birdStatus
    }));
    await clearButtonsAndReply(ctx, entry, `X投稿完了。URL: ${published.tweetUrl}`);
    return { processed: true, result: "applied", reason: "daily_voice_published", callbackId };
  }

  if (entry.action === "song_spawn_inject" || entry.action === "song_spawn_skip" || entry.action === "song_spawn_edit") {
    if (!isSongSpawnEnabled()) {
      return finish(ctx, callbackId, entry, "failed", "song_spawn_disabled", "Song spawn disabled", "failed");
    }
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    const proposalId = entry.proposalId ?? entry.songId ?? entry.commissionBrief?.songId;
    if (entry.action === "song_spawn_edit") {
      await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: "song_spawn_edit_requested", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", "song_spawn_edit_requested"));
      await ctx.client.sendMessage(entry.chatId, "修正するなら /commission に方向性を書き直して投げてくれ。callback に本文は載せない。")
        .catch((error) => logCallbackDeliveryFailure("song_spawn_edit_message", error));
      await ctx.client.editMessageReplyMarkup(entry.chatId, entry.messageId, { inline_keyboard: [] })
        .catch((error) => logCallbackDeliveryFailure("song_spawn_edit_clear_buttons", error));
      return { processed: true, result: "updated", reason: "song_spawn_edit_requested", callbackId };
    }
    if (entry.action === "song_spawn_skip") {
      await markProposalStatusIfPresent(markSpawnProposalDismissed, ctx.root, proposalId);
      const state = await readAutopilotRunState(ctx.root);
      if (state.suspendedAt === "spawn_proposal_ready") {
        await writeAutopilotRunState(ctx.root, {
          ...state,
          stage: "planning",
          suspendedAt: null,
          blockedReason: undefined,
          lastError: undefined,
          lastRunAt: new Date(now).toISOString()
        });
      }
      await markSpawned(ctx.root, new Date(now));
      await markCallbackResolved(ctx.root, callbackId, { status: "discarded", reason: "song_spawn_skipped", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "discarded", "song_spawn_skipped"));
      await clearButtonsAndReply(ctx, entry, "今は見送った。次の spawn 候補はまた間隔を置いて見る。");
      kickAutopilotCycleAfterProducerDecision("song_spawn_skip");
      return { processed: true, result: "discarded", reason: "song_spawn_skipped", callbackId };
    }
    if (!entry.commissionBrief) {
      await markCallbackResolved(ctx.root, callbackId, { status: "failed", reason: "song_spawn_missing_brief", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "failed", "song_spawn_missing_brief"));
      await clearButtonsAndReply(ctx, entry, "spawn brief が見つからない。もう一度作り直す。");
      return { processed: true, result: "failed", reason: "song_spawn_missing_brief", callbackId };
    }
    try {
      const state = await readAutopilotRunState(ctx.root);
      if (await currentSongLaneBusy(ctx.root, state, entry.commissionBrief.songId)) {
        await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "blocked", "draft_box_building_busy"));
        await ctx.client.sendMessage(entry.chatId, `今は ${state.currentSongId ?? "別の曲"} を作ってる。終わったら、同じ草稿箱の「作る」をもう一回押してくれ。待ち行列には入れない。`)
          .catch((error) => logCallbackDeliveryFailure("song_spawn_busy_message", error));
        return { processed: true, result: "blocked", reason: "draft_box_building_busy", callbackId };
      }
      await markProposalStatusIfPresent(markSpawnProposalBuilding, ctx.root, proposalId);
      const injected = await injectCommissionSong(ctx.root, entry.commissionBrief, { now: new Date(now) });
      await markSpawned(ctx.root, new Date(now));
      await markCallbackResolved(ctx.root, callbackId, { status: "applied", reason: "song_spawn_injected", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "applied", "song_spawn_injected"));
      await clearButtonsAndReply(ctx, entry, `作り始めた。songId=${injected.songId}。Suno 生成まで一気に進める。完成したら報告する。`);
      kickAutopilotCycleAfterProducerDecision("song_spawn_inject");
      return { processed: true, result: "applied", reason: "song_spawn_injected", callbackId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "song_spawn_inject_failed";
      await markCallbackResolved(ctx.root, callbackId, { status: "failed", reason, now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "failed", reason));
      await clearButtonsAndReply(ctx, entry, "spawn injection failed. Check the runtime log.");
      return { processed: true, result: "failed", reason, callbackId };
    }
  }

  if (entry.action === "lyrics_redraft") {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    const state = await readAutopilotRunState(ctx.root);
    const songId = entry.songId ?? state.currentSongId ?? "";
    await updateSongState(ctx.root, songId, {
      status: "brief",
      degradedLyrics: false,
      reason: "lyrics_redraft_requested"
    });
    await writeAutopilotRunState(ctx.root, {
      ...state,
      currentSongId: songId,
      stage: "planning",
      paused: false,
      pausedReason: undefined,
      hardStopReason: undefined,
      suspendedAt: null,
      blockedReason: undefined,
      lastError: undefined,
      lastSuccessfulStage: "planning",
      lastRunAt: new Date(now).toISOString()
    });
    await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: "lyrics_redraft_requested", now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", "lyrics_redraft_requested"));
    await clearButtonsAndReply(ctx, entry, "歌詞、もう一回作り直す。Suno 生成の前にまた確認を出す。");
    kickAutopilotCycleAfterProducerDecision("lyrics_redraft");
    return { processed: true, result: "updated", reason: "lyrics_redraft_requested", callbackId };
  }

  if (entry.action === "prompt_pack_go" || entry.action === "prompt_pack_edit" || entry.action === "prompt_pack_skip") {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    const state = await readAutopilotRunState(ctx.root);
    if (entry.action === "prompt_pack_go") {
      await writeAutopilotRunState(ctx.root, {
        ...state,
        currentSongId: entry.songId ?? state.currentSongId,
        stage: "suno_generation",
        suspendedAt: null,
        blockedReason: undefined,
        lastError: undefined,
        lastSuccessfulStage: "prompt_pack",
        lastRunAt: new Date(now).toISOString()
      });
      await markCallbackResolved(ctx.root, callbackId, { status: "applied", reason: "prompt_pack_go", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "applied", "prompt_pack_go"));
      await clearButtonsAndReply(ctx, entry, "了解。Suno 行く。");
      return { processed: true, result: "applied", reason: "prompt_pack_go", callbackId };
    }
    if (entry.action === "prompt_pack_edit") {
      await updateSongState(ctx.root, entry.songId ?? "", { status: "brief", reason: "prompt_pack_lyrics_edit_requested" });
      await writeAutopilotRunState(ctx.root, {
        ...state,
        currentSongId: entry.songId ?? state.currentSongId,
        stage: "planning",
        suspendedAt: null,
        blockedReason: "prompt_pack_lyrics_edit_requested",
        lastError: undefined,
        lastSuccessfulStage: "planning",
        lastRunAt: new Date(now).toISOString()
      });
      await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: "prompt_pack_edit", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", "prompt_pack_edit"));
      await clearButtonsAndReply(ctx, entry, "歌詞、もう一回。");
      return { processed: true, result: "updated", reason: "prompt_pack_edit", callbackId };
    }
    await writeAutopilotRunState(ctx.root, {
      ...state,
      currentSongId: entry.songId ?? state.currentSongId,
      stage: "prompt_pack",
      suspendedAt: "user_paused",
      blockedReason: "user_paused",
      lastError: undefined,
      lastRunAt: new Date(now).toISOString()
    });
    await markCallbackResolved(ctx.root, callbackId, { status: "discarded", reason: "prompt_pack_skip", now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "discarded", "prompt_pack_skip"));
    await clearButtonsAndReply(ctx, entry, "了解、一旦置いとく。");
    return { processed: true, result: "discarded", reason: "prompt_pack_skip", callbackId };
  }

  if (entry.action === "planning_skeleton_apply" || entry.action === "planning_skeleton_skip" || entry.action === "planning_skeleton_edit") {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    if (entry.action === "planning_skeleton_edit") {
      const proposalResult = await handleProposalResponse(ctx.root, {
        proposalId: entry.proposalId ?? "",
        action: "edit",
        actor: { kind: "telegram_callback", chatId: entry.chatId, userId: entry.userId },
        now
      });
      await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: "planning_skeleton_edit_requested", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", proposalResult.status));
      await ctx.client.sendMessage(entry.chatId, "補完案を直すなら /edit <field> <value>、または Producer Console で触ってくれ。")
        .catch((error) => logCallbackDeliveryFailure("planning_skeleton_edit_message", error));
      await ctx.client.editMessageReplyMarkup(entry.chatId, entry.messageId, { inline_keyboard: [] })
        .catch((error) => logCallbackDeliveryFailure("planning_skeleton_edit_clear_buttons", error));
      return { processed: true, result: "updated", reason: proposalResult.status, callbackId };
    }
    const proposalResult = await handleProposalResponse(ctx.root, {
      proposalId: entry.proposalId ?? "",
      action: entry.action === "planning_skeleton_apply" ? "yes" : "no",
      actor: { kind: "telegram_callback", chatId: entry.chatId, userId: entry.userId },
      now
    });
    if (entry.action === "planning_skeleton_apply" && (proposalResult.status === "applied" || proposalResult.status === "already_resolved")) {
      const state = await readAutopilotRunState(ctx.root);
      await writeAutopilotRunState(ctx.root, {
        ...state,
        currentSongId: entry.songId ?? state.currentSongId,
        stage: "prompt_pack",
        suspendedAt: null,
        blockedReason: undefined,
        lastError: undefined,
        lastSuccessfulStage: "planning",
        lastRunAt: new Date(now).toISOString()
      });
    } else if (proposalResult.status === "discarded" || proposalResult.status === "already_resolved") {
      const state = await readAutopilotRunState(ctx.root);
      if (state.suspendedAt === "planning_skeleton_pending") {
        await writeAutopilotRunState(ctx.root, {
          ...state,
          suspendedAt: null,
          lastRunAt: new Date(now).toISOString()
        });
      }
    }
    const callbackStatus: Exclude<CallbackActionStatus, "pending"> =
      proposalResult.status === "applied" ? "applied"
        : proposalResult.status === "discarded" ? "discarded"
          : proposalResult.status === "already_resolved" ? "duplicate"
            : "failed";
    const callbackResult: TelegramCallbackResult["result"] =
      callbackStatus === "applied" ? "applied"
        : callbackStatus === "discarded" ? "discarded"
          : callbackStatus === "duplicate" ? "duplicate"
            : "failed";
    await markCallbackResolved(ctx.root, callbackId, { status: callbackStatus, reason: proposalResult.status, now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, callbackResult, proposalResult.status));
    const message = entry.action === "planning_skeleton_apply"
      ? `Planning補完を反映した。${entry.songId ?? ""} は prompt_pack へ進める。 ${proposalResult.message}`
      : `Planning補完は見送った。${proposalResult.message}`;
    await clearButtonsAndReply(ctx, entry, message);
    return { processed: true, result: callbackResult, reason: proposalResult.status, callbackId };
  }

  if (entry.action === "take_select_accept" || entry.action === "take_select_regenerate" || entry.action === "take_select_skip") {
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    if (entry.action === "take_select_accept") {
      const selected = await selectTake({
        workspaceRoot: ctx.root,
        songId: entry.songId ?? "",
        selectedTakeId: entry.selectedTakeId,
        reason: "producer accepted low-score take"
      });
      emitRuntimeEvent({
        type: "song_take_completed",
        songId: selected.songId,
        selectedTakeId: selected.selectedTakeId,
        urls: selected.sourceUrls,
        timestamp: Date.now()
      });
      await markCallbackResolved(ctx.root, callbackId, { status: "applied", reason: "take_selected", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "applied", "take_selected"));
      await clearButtonsAndReply(ctx, entry, `Take selected: ${selected.selectedTakeId}`);
      return { processed: true, result: "applied", reason: "take_selected", callbackId };
    }
    if (entry.action === "take_select_regenerate") {
      await updateSongState(ctx.root, entry.songId ?? "", { status: "suno_prompt_pack", reason: "take_select_regenerate_requested" });
      const state = await readAutopilotRunState(ctx.root);
      await writeAutopilotRunState(ctx.root, {
        ...state,
        currentSongId: entry.songId ?? state.currentSongId,
        stage: "suno_generation",
        retryCount: 0,
        blockedReason: "take_select_regenerate_requested",
        lastError: undefined
      });
      await markCallbackResolved(ctx.root, callbackId, { status: "updated", reason: "take_select_regenerate_requested", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "updated", "take_select_regenerate_requested"));
      await clearButtonsAndReply(ctx, entry, "Suno regeneration queued.");
      return { processed: true, result: "updated", reason: "take_select_regenerate_requested", callbackId };
    }
    await markCallbackResolved(ctx.root, callbackId, { status: "discarded", reason: "take_select_skipped", now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "discarded", "take_select_skipped"));
    await clearButtonsAndReply(ctx, entry, "Take selection skipped for now.");
    return { processed: true, result: "discarded", reason: "take_select_skipped", callbackId };
  }

  if (entry.action === "x_publish_prepare" || entry.action === "x_publish_confirm" || entry.action === "x_publish_cancel") {
    if (!isXInlineButtonEnabled()) {
      return finish(ctx, callbackId, entry, "failed", "x_inline_button_disabled", "X button disabled", "failed");
    }
    await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "OK" });
    if (entry.action === "x_publish_cancel") {
      const cancelled = await executeXPublishAction({ root: ctx.root, songId: entry.songId ?? "", action: "x_publish_cancel", actor: ctx.actor });
      await markCallbackResolved(ctx.root, callbackId, { status: "discarded", reason: cancelled.status, now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "discarded", cancelled.status));
      await clearButtonsAndReply(ctx, entry, "X投稿は取り消した。");
      return { processed: true, result: "discarded", reason: cancelled.status, callbackId };
    }
    if (entry.action === "x_publish_prepare") {
      const song = await readSongState(ctx.root, entry.songId ?? "");
      const prepared = await executeXPublishAction({
        root: ctx.root,
        songId: entry.songId ?? "",
        action: "x_publish_prepare",
        actor: ctx.actor,
        songState: song,
        sunoUrl: entry.draftUrl
      });
      if (prepared.status !== "prepared" || !prepared.draft) {
        await markCallbackResolved(ctx.root, callbackId, { status: "failed", reason: prepared.reason ?? prepared.status, now });
        await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "failed", prepared.reason ?? prepared.status));
        await clearButtonsAndReply(ctx, entry, `X投稿準備に失敗: ${prepared.reason ?? prepared.status}`);
        return { processed: true, result: "failed", reason: prepared.reason ?? prepared.status, callbackId };
      }
      const [confirm, cancel] = await Promise.all([
        registerCallbackAction(ctx.root, {
          action: "x_publish_confirm",
          songId: entry.songId,
          draftText: prepared.draft.draftText,
          draftHash: prepared.draft.draftHash,
          draftCharCount: prepared.draft.draftCharCount,
          draftUrl: prepared.draft.draftUrl,
          chatId: entry.chatId,
          messageId: entry.messageId,
          userId: entry.userId,
          now,
          expiresAt: entry.expiresAt
        }),
        registerCallbackAction(ctx.root, {
          action: "x_publish_cancel",
          songId: entry.songId,
          draftHash: prepared.draft.draftHash,
          draftCharCount: prepared.draft.draftCharCount,
          chatId: entry.chatId,
          messageId: entry.messageId,
          userId: entry.userId,
          now,
          expiresAt: entry.expiresAt
        })
      ]);
      await markCallbackResolved(ctx.root, callbackId, { status: "applied", reason: "prepared", now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "applied", "prepared", {
        draftHash: prepared.draft.draftHash,
        draftCharCount: prepared.draft.draftCharCount
      }));
      await clearButtonsAndReply(ctx, entry, xPreviewText(prepared.draft.draftText, prepared.draft.draftHash, prepared.draft.draftCharCount), {
        replyMarkup: { inline_keyboard: [[
          { text: "▶ Xに投稿", callback_data: `cb:${confirm.callbackId}` },
          { text: "⏸ やめる", callback_data: `cb:${cancel.callbackId}` }
        ]] }
      });
      return { processed: true, result: "applied", reason: "prepared", callbackId };
    }

    const published = await executeXPublishAction({
      root: ctx.root,
      songId: entry.songId ?? "",
      action: "x_publish_confirm",
      actor: ctx.actor,
      entry,
      spawnImpl: ctx.xPublishSpawnImpl
    });
    if (published.status !== "published" || !published.tweetUrl) {
      await markCallbackResolved(ctx.root, callbackId, { status: "failed", reason: published.reason ?? published.status, now });
      await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "failed", published.reason ?? published.status, {
        draftHash: entry.draftHash,
        draftCharCount: entry.draftCharCount,
        birdStatus: published.birdStatus
      }));
      await clearButtonsAndReply(ctx, entry, `X投稿に失敗: ${published.reason ?? published.status}`);
      return { processed: true, result: "failed", reason: published.reason ?? published.status, callbackId };
    }
    await applyChangeSet(ctx.root, xPublishSongbookProposal(entry.songId ?? "", published.tweetUrl, now));
    await markCallbackResolved(ctx.root, callbackId, { status: "applied", reason: "published", now });
    await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "applied", "published", {
      draftHash: entry.draftHash,
      draftCharCount: entry.draftCharCount,
      tweetUrl: published.tweetUrl,
      birdStatus: published.birdStatus
    }));
    await clearButtonsAndReply(ctx, entry, `X投稿完了。URL: ${published.tweetUrl}`);
    return { processed: true, result: "applied", reason: "published", callbackId };
  }

  await ctx.client.answerCallbackQuery(ctx.callbackQueryId, { text: "Unsupported action" });
  await markCallbackResolved(ctx.root, callbackId, { status: "failed", reason: "unsupported_action", now });
  await appendCallbackAudit(ctx.root, auditBase(ctx, callbackId, entry, "failed", "unsupported_action"));
  await ctx.client.editMessageReplyMarkup(entry.chatId, entry.messageId, { inline_keyboard: [] })
    .catch((error) => logCallbackDeliveryFailure("unsupported_action_clear_buttons", error));
  return { processed: true, result: "failed", reason: "unsupported_action", callbackId };
}
