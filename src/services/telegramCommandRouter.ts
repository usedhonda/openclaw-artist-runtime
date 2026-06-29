import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AiReviewProvider, AutopilotStatus } from "../types.js";
import { readAutopilotRunState, stageFromSong } from "./autopilotService.js";
import { AutopilotControlService } from "./autopilotControlService.js";
import { getAutopilotTicker } from "./autopilotTicker.js";
import { readSongState } from "./artistState.js";
import { formatDebugAiReviewResult, reviewSongDebugMaterial } from "./debugAiReviewService.js";
import { auditPersonaCompleteness, formatPersonaAuditReport, type PersonaFieldAudit } from "./personaFieldAuditor.js";
import { readArtistPersonaSummary } from "./personaFileBuilder.js";
import { proposePersonaFields } from "./personaProposer.js";
import { getSongDetail, listRecentSongs } from "./songQueryService.js";
import { readSongMaterial } from "./songMaterialReader.js";
import { createTelegramPersonaSession, handleTelegramPersonaSessionMessage } from "./telegramPersonaSession.js";
import { formatPersonaMigratePlan, planPersonaMigrate } from "./personaMigrator.js";
import { isLegacyWizardEnabled } from "./runtimeConfig.js";
import { readSoulPersonaSummary } from "./soulFileBuilder.js";
import { isConversationalSongCreate, routeTelegramConversation, type TelegramProposalButtonsRequest } from "./telegramConversationalRouter.js";
import { readObservationsReport, type ObservationReport } from "./xObservationCollector.js";
import { wrapCommandVoice, type CommandVoiceKind } from "./commandVoiceWrapper.js";
import { composeProducerStatus } from "./producerStatusComposer.js";
import { isProposalConfirmationAction, listPendingCallbackActionSummaries } from "./callbackActionRegistry.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { appendFailedNotifyReplayRecord, latestFailedNotifyEntry, listUnreplayedFailedNotifications } from "./failedNotifyLedger.js";
import { resurfaceDegradedLyrics } from "./degradedLyricsResurfaceService.js";
import { resurfacePromptPackReady } from "./promptPackResurfaceService.js";
import { stampInbound } from "./receiveHealthService.js";

export type TelegramCommandKind =
  | "help"
  | "status"
  | "songs"
  | "song"
  | "timeline"
  | "regen"
  | "review"
  | "pause"
  | "resume"
  | "replay"
  | "setup"
  | "persona"
  | "observations"
  | "unknown"
  | "free_text";

export interface TelegramRouteInput {
  text: string;
  fromUserId: number;
  chatId: number;
  workspaceRoot?: string;
  autopilotStatus?: AutopilotStatus;
  aiReviewProvider?: AiReviewProvider;
  dashboardBaseUrl?: string;
}

export interface TelegramRouteResult {
  kind: TelegramCommandKind;
  responseText: string;
  shouldStoreFreeText: boolean;
  proposalButtons?: TelegramProposalButtonsRequest;
  statusDecisionButtons?: TelegramStatusDecisionButtonsRequest;
}

export type TelegramStatusDecisionAction =
  | "song_archive"
  | "song_discard"
  | "song_songbook_write"
  | "song_skip"
  | "song_spawn_inject"
  | "song_spawn_skip"
  | "song_spawn_edit"
  | "prompt_pack_go"
  | "prompt_pack_edit"
  | "prompt_pack_skip";

export interface TelegramStatusDecisionButtonsRequest {
  songId: string;
  selectedTakeId?: string;
  actions: TelegramStatusDecisionAction[];
}

function inboxPath(root: string): string {
  return join(root, "runtime", "telegram-inbox.jsonl");
}

function formatStatus(status?: AutopilotStatus): string {
  if (!status) {
    return "Autopilot status unavailable.";
  }
  return [
    `Autopilot: ${status.enabled ? "enabled" : "disabled"}${status.dryRun ? " (dry-run)" : ""}`,
    `Stage: ${status.stage}`,
    `Next: ${status.nextAction}`,
    status.currentSongId ? `Song: ${status.currentSongId}` : undefined,
    status.blockedReason ? `Blocked: ${status.blockedReason}` : undefined
  ].filter(Boolean).join("\n");
}

export function isProducerStatusIntent(text: string): boolean {
  const normalized = text.trim().replace(/[？?。!！\s]/g, "").toLowerCase();
  if (!normalized) return false;
  return /^(いま|今|状況|状況教えて|どこ|どこまで|進捗|進捗教えて|何待ち|なに待ち|ステータス|status)$/.test(normalized);
}

async function voiceCommand(kind: CommandVoiceKind, info: string, input: TelegramRouteInput, userMessage?: string): Promise<string> {
  return wrapCommandVoice({
    kind,
    info,
    workspaceRoot: input.workspaceRoot,
    userMessage: userMessage ?? input.text
  });
}

function logCommandSideEffectFailure(context: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[telegram-command] ${context} failed: ${reason}`);
}

const STATUS_DECISION_ACTIONS: readonly TelegramStatusDecisionAction[] = [
  "song_archive",
  "song_discard",
  "song_songbook_write",
  "song_skip",
  "song_spawn_inject",
  "song_spawn_skip",
  "song_spawn_edit",
  "prompt_pack_go",
  "prompt_pack_edit",
  "prompt_pack_skip"
];

async function latestStatusDecisionButtons(root: string, now = Date.now()): Promise<TelegramStatusDecisionButtonsRequest | undefined> {
  const pending = await listPendingCallbackActionSummaries(root, {
    category: "producer_decision",
    limit: 30,
    now
  });
  const latest = pending.recent[0];
  if (!latest?.songId) {
    return undefined;
  }
  const actions = STATUS_DECISION_ACTIONS.filter((action) =>
    pending.recent.some((entry) =>
      entry.songId === latest.songId
      && entry.messageId === latest.messageId
      && entry.action === action
    )
  );
  if (actions.length === 0) {
    return undefined;
  }
  const songReviewActions = new Set<TelegramStatusDecisionAction>(["song_archive", "song_discard", "song_songbook_write", "song_skip"]);
  const requiresReviewSong = actions.some((action) => songReviewActions.has(action));
  const song = latest.songId ? await readSongState(root, latest.songId).catch(() => undefined) : undefined;
  if (requiresReviewSong && (!song || (song.status !== "take_selected" && song.status !== "suno_take_url_ready"))) {
    return undefined;
  }
  return {
    songId: latest.songId,
    selectedTakeId: song?.selectedTakeId,
    actions
  };
}

async function latestProposalButtons(root: string, now = Date.now()): Promise<TelegramProposalButtonsRequest | undefined> {
  const pending = await listPendingCallbackActionSummaries(root, {
    category: "working_confirmation",
    limit: 30,
    now
  });
  const latest = pending.recent.find((entry) => entry.proposalId && isProposalConfirmationAction(entry.action));
  return latest?.proposalId ? { proposalId: latest.proposalId } : undefined;
}

function helpInfo(): string {
  return [
    "Available commands:",
    "/status - show autopilot status",
    "/timeline - show song lifecycle timeline",
    "/songs - list recent songs",
    "/song <songId> - show song detail",
    "/song create [hint] - ask the artist to make a song",
    "/commission <brief> - propose a producer commission for autopilot",
    "/regen <songId> - queue a dry-run regeneration note",
    "/review <songId> - run a debug-only mock AI review",
    "/setup - talk with the artist about persona direction",
    "/persona show|fields|check|reset|migrate - inspect or migrate persona files",
    "/observations [YYYY-MM-DD] - show what artist-runtime collected from X",
    "/pause - pause autopilot",
    "/resume - resume autopilot",
    "/replay - resend failed Telegram notifications",
    "/help - show this help"
  ].join("\n");
}

function dashboardSongLink(input: TelegramRouteInput, songId: string): string | undefined {
  const baseUrl = input.dashboardBaseUrl?.replace(/\/+$/, "");
  return baseUrl ? `↗ ${baseUrl}/plugins/artist-runtime#song=${songId}` : undefined;
}

function songResourceLines(input: TelegramRouteInput, songId: string): string[] {
  return [
    `path: songs/${songId}/`,
    dashboardSongLink(input, songId)
  ].filter((line): line is string => Boolean(line));
}

function formatUpdatedAt(value?: string, now = Date.now()): string {
  if (!value) return "unknown";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return value;
  const diffMinutes = Math.max(0, Math.round((now - time) / 60_000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}分前`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}時間前`;
  return `${Math.round(diffHours / 24)}日前`;
}

function isSongActive(status: string): boolean {
  return !["published", "archived", "failed"].includes(status);
}

async function formatTimelineInfo(input: TelegramRouteInput): Promise<string> {
  if (!input.workspaceRoot) {
    return "Timeline unavailable: workspace root missing.";
  }
  const songs = await listRecentSongs(input.workspaceRoot, 10);
  if (songs.length === 0) {
    return "No songs yet.";
  }
  const lines = ["🎬 Timeline (recent 10 songs)", ""];
  for (const song of songs) {
    const stage = stageFromSong({ status: song.status } as Parameters<typeof stageFromSong>[0]);
    const prefix = isSongActive(song.status) ? "▶" : " ";
    lines.push(`${prefix} ${song.songId} | ${stage} | "${song.title}"`);
    lines.push(`  更新: ${formatUpdatedAt(song.updatedAt)}`);
    lines.push(`  path: songs/${song.songId}/`);
    const link = dashboardSongLink(input, song.songId);
    if (link) lines.push(`  ${link}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export async function routeTelegramCommand(input: TelegramRouteInput): Promise<TelegramRouteResult> {
  const text = input.text.trim();
  // Plan v10.65 Layer 1: record that inbound text physically reached the plugin.
  if (input.workspaceRoot) {
    await stampInbound(input.workspaceRoot);
  }
  if (!text) {
    return {
      kind: "unknown",
      responseText: await voiceCommand("error", "Send /help for available artist-runtime commands.", input, "empty command"),
      shouldStoreFreeText: false
    };
  }

  if (input.workspaceRoot) {
    const personaSessionResponse = await handleTelegramPersonaSessionMessage(input.workspaceRoot, text);
    if (personaSessionResponse) {
      return { kind: "persona", responseText: personaSessionResponse, shouldStoreFreeText: false };
    }
  }

  const [commandRaw, ...args] = text.split(/\s+/);
  const command = commandRaw.toLowerCase();
  if (input.workspaceRoot && (!command.startsWith("/") ? isProducerStatusIntent(text) : command === "/status")) {
    const statusDecisionButtons = await latestStatusDecisionButtons(input.workspaceRoot);
    return {
      kind: "status",
      responseText: await composeProducerStatus(input.workspaceRoot, {
        dashboardBaseUrl: input.dashboardBaseUrl,
        autopilotStatus: input.autopilotStatus
      }),
      shouldStoreFreeText: false,
      statusDecisionButtons,
      proposalButtons: statusDecisionButtons ? undefined : await latestProposalButtons(input.workspaceRoot)
    };
  }
  if (input.workspaceRoot && !isLegacyWizardEnabled()) {
    if (
      command === "/talk"
      || command === "/commission"
      || command === "/yes"
      || command === "/no"
      || command === "/edit"
      || command === "/one"
      || command === "/confirm"
      || command === "/cancel"
      || (command === "/persona" && !["check", "show", "fields", "edit", "reset", "migrate"].includes(args[0]?.toLowerCase() ?? ""))
      || (command === "/song" && (isConversationalSongCreate(text) || (args.length > 1 && !["update", "add"].includes(args[0]?.toLowerCase() ?? ""))))
      || !command.startsWith("/")
    ) {
      const routed = await routeTelegramConversation({
        text,
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: command === "/song" ? "song" : command === "/persona" ? "persona" : "free_text", ...routed };
    }
    if (command === "/skip" || command === "/back" || command === "/answer") {
      return {
        kind: "free_text",
        responseText: await voiceCommand("ack", "Legacy wizard command ignored. Speak normally and the artist conversation router will pick it up.", input, "legacy wizard ignored"),
        shouldStoreFreeText: false
      };
    }
  }
  if (command === "/help" || command === "/start") {
    return {
      kind: "help",
      responseText: await voiceCommand("help", helpInfo(), input),
      shouldStoreFreeText: false
    };
  }

  if (command === "/setup") {
    if (!input.workspaceRoot) {
      return { kind: "setup", responseText: "Persona setup unavailable: workspace root missing.", shouldStoreFreeText: false };
    }
    const routed = await routeTelegramConversation({
      text: args.length > 0 ? `/persona ${args.join(" ")}` : "/persona アーティストの輪郭を一緒に決めたい",
      fromUserId: input.fromUserId,
      chatId: input.chatId,
      workspaceRoot: input.workspaceRoot,
      autopilotStatus: input.autopilotStatus,
      aiReviewProvider: input.aiReviewProvider
    });
    return { kind: "setup", ...routed };
  }

  if (command === "/persona") {
    if (!input.workspaceRoot) {
      return { kind: "persona", responseText: "Persona command unavailable: workspace root missing.", shouldStoreFreeText: false };
    }
    const subcommand = args[0]?.toLowerCase();
    if (subcommand === "fields") {
      return { kind: "persona", responseText: formatPersonaFields(), shouldStoreFreeText: false };
    }
    if (subcommand === "show") {
      return { kind: "persona", responseText: await formatPersonaShow(input.workspaceRoot), shouldStoreFreeText: false };
    }
    if (subcommand === "check") {
      const mode = args[1]?.toLowerCase();
      const report = await auditPersonaCompleteness(input.workspaceRoot);
      if (mode === "fill") {
        return {
          kind: "persona",
          responseText: [
            formatPersonaCheckSummary(report),
            "",
            "Wizard fill has been retired. Tell the artist what you want changed in normal language, then approve the proposed ChangeSet with /yes."
          ].join("\n"),
          shouldStoreFreeText: false
        };
      }
      if (mode === "suggest") {
        return {
          kind: "persona",
          responseText: await formatPersonaSuggestions(report, input.aiReviewProvider, input.workspaceRoot),
          shouldStoreFreeText: false
        };
      }
      return { kind: "persona", responseText: formatPersonaCheckReport(report), shouldStoreFreeText: false };
    }
    if (subcommand === "edit") {
      const routed = await routeTelegramConversation({
        text: `/persona ${args.slice(1).join(" ") || "personaを自然な会話で直したい"}`,
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: "persona", ...routed };
    }
    if (subcommand === "reset") {
      await createTelegramPersonaSession(input.workspaceRoot, {
        mode: "reset_confirm",
        chatId: input.chatId,
        userId: input.fromUserId
      });
      return {
        kind: "persona",
        responseText: "This will replace Telegram-managed ARTIST/SOUL persona blocks. Reply /confirm reset or /cancel.",
        shouldStoreFreeText: false
      };
    }
    if (subcommand === "migrate") {
      const migrateMatch = text.match(/^\/persona\s+migrate(?:\s+([\s\S]*))?$/i);
      const intent = migrateMatch?.[1]?.trim() || undefined;
      const plan = await planPersonaMigrate(input.workspaceRoot, { intent, aiReviewProvider: input.aiReviewProvider });
      await createTelegramPersonaSession(input.workspaceRoot, {
        mode: "migrate_confirm",
        chatId: input.chatId,
        userId: input.fromUserId,
        migrateIntent: intent,
        migrateAiReviewProvider: input.aiReviewProvider
      });
      return {
        kind: "persona",
        responseText: formatPersonaMigratePlan(plan),
        shouldStoreFreeText: false
      };
    }
    return {
      kind: "persona",
      responseText: "Usage: /persona show | /persona fields | /persona check [suggest] | /persona reset | /persona migrate",
      shouldStoreFreeText: false
    };
  }

  if (command === "/status") {
    return {
      kind: "status",
      responseText: await voiceCommand("status", formatStatus(input.autopilotStatus), input),
      shouldStoreFreeText: false
    };
  }

  if (command === "/timeline") {
    const info = await formatTimelineInfo(input);
    return {
      kind: "timeline",
      responseText: await voiceCommand("songs", info, input),
      shouldStoreFreeText: false
    };
  }

  if (command === "/songs") {
    if (!input.workspaceRoot) {
      return { kind: "songs", responseText: await voiceCommand("error", "Song list unavailable: workspace root missing.", input, "songs unavailable"), shouldStoreFreeText: false };
    }
    const songs = await listRecentSongs(input.workspaceRoot, 10);
    const info = songs.length === 0
      ? "No songs yet."
      : songs.map((song) => [
        `${song.songId} | ${song.status} | ${song.title}`,
        ...songResourceLines(input, song.songId).map((line) => `  ${line}`)
      ].join("\n")).join("\n");
    return {
      kind: "songs",
      responseText: await voiceCommand("songs", info, input),
      shouldStoreFreeText: false
    };
  }

  if (command === "/song") {
    const subcommand = args[0]?.toLowerCase();
    if (subcommand === "update") {
      if (!input.workspaceRoot || !args[1]) {
        return { kind: "song", responseText: await voiceCommand("error", "Usage: /song update <songId>", input, "song update usage"), shouldStoreFreeText: false };
      }
      const routed = await routeTelegramConversation({
        text: `/song ${args[1]} ${args.slice(2).join(" ") || "この曲を更新したい"}`,
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: "song", ...routed };
    }
    if (subcommand === "add") {
      if (!input.workspaceRoot) {
        return { kind: "song", responseText: await voiceCommand("error", "Song add unavailable: workspace root missing.", input, "song add unavailable"), shouldStoreFreeText: false };
      }
      const routed = await routeTelegramConversation({
        text: `/song create ${args.slice(1).join(" ")}`.trim(),
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: "song", ...routed };
    }
    if (subcommand === "create") {
      if (!input.workspaceRoot) {
        return { kind: "song", responseText: await voiceCommand("error", "Song create unavailable: workspace root missing.", input, "song create unavailable"), shouldStoreFreeText: false };
      }
      const routed = await routeTelegramConversation({
        text,
        fromUserId: input.fromUserId,
        chatId: input.chatId,
        workspaceRoot: input.workspaceRoot,
        autopilotStatus: input.autopilotStatus,
        aiReviewProvider: input.aiReviewProvider
      });
      return { kind: "song", ...routed };
    }
    const songId = args[0];
    if (!input.workspaceRoot || !songId) {
      return { kind: "song", responseText: await voiceCommand("error", "Usage: /song <songId> | /song update <songId> | /song add", input, "song usage"), shouldStoreFreeText: false };
    }
    const song = await getSongDetail(input.workspaceRoot, songId);
    const info = [
      `${song.songId} | ${song.status} | ${song.title}`,
      song.selectedTakeId ? `Selected take: ${song.selectedTakeId}` : undefined,
      `Imported assets: ${song.importedPaths.length}`,
      song.brief ? `Brief: ${song.brief.slice(0, 240)}` : undefined,
      `brief path: songs/${song.songId}/brief.md`,
      `lyrics path: songs/${song.songId}/LYRICS.md`,
      dashboardSongLink(input, song.songId)
    ].filter(Boolean).join("\n");
    return {
      kind: "song",
      responseText: await voiceCommand("song", info, input, "song detail"),
      shouldStoreFreeText: false
    };
  }

  if (command === "/observations") {
    if (!input.workspaceRoot) {
      return { kind: "observations", responseText: await voiceCommand("error", "Observations unavailable: workspace root missing.", input, "observations unavailable"), shouldStoreFreeText: false };
    }
    const dateArg = args[0]?.trim();
    const report = await readObservationsReport(input.workspaceRoot, dateArg || new Date());
    return { kind: "observations", responseText: await voiceCommand("observations", formatObservationsReport(report), input, "observations report"), shouldStoreFreeText: false };
  }

  if (command === "/regen") {
    const songId = args[0];
    if (!input.workspaceRoot || !songId) {
      return { kind: "regen", responseText: "Usage: /regen <songId>", shouldStoreFreeText: false };
    }
    await storeTelegramInbox(input.workspaceRoot, {
      type: "regen_requested",
      songId,
      fromUserId: input.fromUserId,
      chatId: input.chatId,
      text,
      timestamp: Date.now()
    });
    return {
      kind: "regen",
      responseText: `Queued dry-run regeneration request for ${songId}. No Suno create was started.`,
      shouldStoreFreeText: false
    };
  }

  if (command === "/review") {
    const songId = args[0];
    if (!input.workspaceRoot || !songId) {
      return { kind: "review", responseText: "Usage: /review <songId>", shouldStoreFreeText: false };
    }
    try {
      const material = await readSongMaterial(input.workspaceRoot, songId);
      const result = await reviewSongDebugMaterial(input.workspaceRoot, material, input.aiReviewProvider);
      return { kind: "review", responseText: formatDebugAiReviewResult(result), shouldStoreFreeText: false };
    } catch {
      return {
        kind: "review",
        responseText: `Debug review unavailable for ${songId}: song material was not found.`,
        shouldStoreFreeText: false
      };
    }
  }

  if (command === "/pause") {
    if (!input.workspaceRoot) {
      return { kind: "pause", responseText: await voiceCommand("error", "Pause unavailable: workspace root missing.", input, "pause unavailable"), shouldStoreFreeText: false };
    }
    await new AutopilotControlService().pause(input.workspaceRoot, `telegram:${input.fromUserId}`);
    return { kind: "pause", responseText: await voiceCommand("ack", "Autopilot paused.", input, "autopilot paused"), shouldStoreFreeText: false };
  }

  if (command === "/resume") {
    if (!input.workspaceRoot) {
      return { kind: "resume", responseText: await voiceCommand("error", "Resume unavailable: workspace root missing.", input, "resume unavailable"), shouldStoreFreeText: false };
    }
    const state = await readAutopilotRunState(input.workspaceRoot);
    const currentSong = state.currentSongId
      ? await readSongState(input.workspaceRoot, state.currentSongId).catch(() => undefined)
      : undefined;
    if (currentSong?.degradedLyrics && typeof state.blockedReason === "string" && state.blockedReason.includes("lyrics_generation_degraded")) {
      const resurface = await resurfaceDegradedLyrics(input.workspaceRoot, { songId: currentSong.songId });
      const info = resurface.resurfaced
        ? `この曲は歌詞生成に失敗して止まってる。${currentSong.songId} の「破棄」か「歌詞を作り直す」を選んで。`
        : `この曲は歌詞生成に失敗して止まってる。再表示できなかった: ${resurface.reason}`;
      return { kind: "resume", responseText: await voiceCommand("ack", info, input, "lyrics degraded recovery surfaced"), shouldStoreFreeText: false };
    }
    await new AutopilotControlService().resume(input.workspaceRoot, { reason: `telegram:${input.fromUserId}`, source: "telegram" });
    const resurface = await resurfacePromptPackReady(input.workspaceRoot, { requireExpiredGo: true });
    if (resurface.resurfaced) {
      const info = `Autopilot resumed. ${resurface.songId} は Suno 生成 GO 待ちだったので、最新の GO ボタンを再表示した。`;
      return { kind: "resume", responseText: await voiceCommand("ack", info, input, "autopilot resumed"), shouldStoreFreeText: false };
    }
    // Plan v10.66: /resume must CONTINUE the current song from Telegram, not just clear
    // the block and idle until the next ticker tick (cycleIntervalMinutes, default 180).
    // Telegram is the operator's only surface, so "再開して" has to actually move the song.
    // Kick one immediate cycle when a mid-pipeline current song remains AND no producer
    // GO gate is pending — GO-gate suspensions (spawn_proposal_ready / prompt_pack_ready /
    // planning_skeleton_pending) keep their suspendedAt through resume and must wait for
    // the operator's GO button, never auto-fire. This is the operator's own Telegram
    // action, so the resulting LIVE work is operator-initiated, not an autopilot
    // script-fire. runCycle advances one stage and re-applies downstream gates.
    const afterResume = await readAutopilotRunState(input.workspaceRoot);
    const resumedSong = afterResume.currentSongId
      ? await readSongState(input.workspaceRoot, afterResume.currentSongId).catch(() => undefined)
      : undefined;
    const terminalStatuses = new Set(["published", "archived", "discarded", "failed"]);
    if (
      !afterResume.currentSongId
      && !afterResume.suspendedAt
      && state.blockedReason === "song_spawn_waiting_for_proposal"
    ) {
      void getAutopilotTicker().runNow().catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        logCommandSideEffectFailure("resume spawn proposal runNow", error);
        emitRuntimeEvent({
          type: "error",
          source: "telegram_resume_run_now",
          reason,
          timestamp: Date.now()
        });
      });
      const info = "Autopilot resumed。次の曲案を今すぐ探す。提案が出たらTelegramに出す。";
      return { kind: "resume", responseText: await voiceCommand("ack", info, input, "autopilot resumed and spawn proposal cycle kicked"), shouldStoreFreeText: false };
    }
    if (afterResume.currentSongId && !afterResume.suspendedAt && resumedSong && !terminalStatuses.has(resumedSong.status)) {
      void getAutopilotTicker().runNow().catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        logCommandSideEffectFailure("resume immediate runNow", error);
        emitRuntimeEvent({
          type: "error",
          source: "telegram_resume_run_now",
          reason,
          songId: afterResume.currentSongId,
          timestamp: Date.now()
        });
      });
      const info = `Autopilot resumed。${afterResume.currentSongId} の続きを今すぐ進める。できあがったら知らせる。`;
      return { kind: "resume", responseText: await voiceCommand("ack", info, input, "autopilot resumed and cycle kicked"), shouldStoreFreeText: false };
    }
    return { kind: "resume", responseText: await voiceCommand("ack", "Autopilot resumed.", input, "autopilot resumed"), shouldStoreFreeText: false };
  }

  if (command === "/replay") {
    if (!input.workspaceRoot) {
      return { kind: "replay", responseText: await voiceCommand("error", "Replay unavailable: workspace root missing.", input, "replay unavailable"), shouldStoreFreeText: false };
    }
    // Plan v10.56 Phase 3: re-send critical Telegram notifications that previously
    // failed to deliver — from Telegram itself (was API/UI-only). Re-emits the stored
    // event payload through the runtime bus so the notifier formatter re-delivers it.
    const pending = await listUnreplayedFailedNotifications(input.workspaceRoot);
    if (pending.length === 0) {
      return { kind: "replay", responseText: await voiceCommand("ack", "再送が必要な通知はありません。", input, "no failed notifications"), shouldStoreFreeText: false };
    }
    let replayed = 0;
    for (const summary of pending) {
      const entry = await latestFailedNotifyEntry(input.workspaceRoot, summary.notifyId);
      if (!entry || entry.status === "replayed") {
        continue;
      }
      try {
        emitRuntimeEvent(entry.eventPayload);
        await appendFailedNotifyReplayRecord(input.workspaceRoot, entry, { ok: true });
        replayed += 1;
      } catch (error) {
        await appendFailedNotifyReplayRecord(input.workspaceRoot, entry, { ok: false, error });
      }
    }
    return { kind: "replay", responseText: await voiceCommand("ack", `届かなかった通知を ${replayed} 件再送した。`, input, "failed notifications replayed"), shouldStoreFreeText: false };
  }

  if (command.startsWith("/")) {
    return {
      kind: "unknown",
      responseText: await voiceCommand("error", `Unknown command: ${command}. Send /help for available commands.`, input, "unknown command"),
      shouldStoreFreeText: false
    };
  }

  return {
    kind: "free_text",
    responseText: await voiceCommand("ack", "Instruction received for local artist inbox staging.", input, "free text staged"),
    shouldStoreFreeText: true
  };
}

function needsPersonaFill(field: PersonaFieldAudit): boolean {
  return field.status === "missing" || field.status === "thin";
}

function formatPersonaCheckSummary(report: Awaited<ReturnType<typeof auditPersonaCompleteness>>): string {
  const needs = report.fields.filter(needsPersonaFill).map((field) => field.field);
  return [
    `Persona check: ${report.summary.filled} filled, ${report.summary.thin} thin, ${report.summary.missing} missing.`,
    needs.length > 0 ? `Needs: ${needs.join(", ")}` : "All fields filled.",
    report.customSections.length > 0 ? `Custom sections: ${report.customSections.join(", ")}` : undefined
  ].filter(Boolean).join("\n");
}

function formatPersonaCheckReport(report: Awaited<ReturnType<typeof auditPersonaCompleteness>>): string {
  const full = formatPersonaAuditReport(report);
  if (full.length <= 1500) {
    return full;
  }
  return formatPersonaCheckSummary(report);
}

async function formatPersonaSuggestions(
  report: Awaited<ReturnType<typeof auditPersonaCompleteness>>,
  provider?: AiReviewProvider,
  root?: string
): Promise<string> {
  const fields = report.fields.filter(needsPersonaFill).map((field) => field.field);
  if (fields.length === 0) {
    return "Persona suggestion mode: all fields are filled.";
  }
  const [artistMd, soulMd] = root
    ? await Promise.all([
        readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
        readFile(join(root, "SOUL.md"), "utf8").catch(() => "")
      ])
    : ["", ""];
  const result = await proposePersonaFields({
    fields,
    source: {
      artistMd,
      soulMd,
      customSections: report.customSections
    }
  }, { aiReviewProvider: provider });
  return [
    "Persona suggestion mode:",
    `Provider: ${result.provider}`,
    ...result.drafts.map((draft) =>
      draft.status === "skipped"
        ? `- ${draft.field}: skipped${draft.reasoning ? ` (${draft.reasoning})` : ""}`
        : `- ${draft.field}: ${draft.draft}${draft.reasoning ? ` (${draft.reasoning})` : ""}`
    ),
    result.provider === "mock" ? "Mock provider placeholder drafts only." : undefined,
    result.provider === "not_configured" ? "Configure AI provider for suggestions (currently mock)." : undefined,
    result.warnings.length > 0 ? `Warnings: ${result.warnings.join("; ")}` : undefined
  ].filter(Boolean).join("\n");
}

function formatPersonaFields(): string {
  return [
    "Editable persona fields:",
    "CONFIG: artistName",
    "ARTIST: identity, sound, themes, lyrics, social",
    "SOUL: soul-tone, soul-refusal"
  ].join("\n");
}

async function formatPersonaShow(root: string): Promise<string> {
  const [artist, soul] = await Promise.all([readArtistPersonaSummary(root), readSoulPersonaSummary(root)]);
  const response = [
    `Artist: ${artist.artistName}`,
    `Identity: ${artist.identityLine}`,
    `Sound: ${artist.soundDna}`,
    `Themes: ${artist.obsessions}`,
    `Lyrics guard: ${artist.lyricsRules}`,
    `Social voice: ${artist.socialVoice}`,
    "---",
    `Conversation tone: ${soul.conversationTone || "(not set)"}`,
    `Refusal style: ${soul.refusalStyle || "(not set)"}`
  ].join("\n");
  return response.length > 1600 ? `${response.slice(0, 1597)}...` : response;
}

function truncateInline(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

export function formatObservationsReport(report: ObservationReport): string {
  const header = `🌐 X 観察 ${report.date}`;
  if (!report.exists || report.entries.length === 0) {
    return [
      header,
      report.exists ? "(エントリなし)" : "(まだ収集されてない)",
      `Source: ${report.path}`
    ].join("\n");
  }
  const top = report.entries
    .filter((entry) => {
      const text = entry.text?.trim() ?? "";
      if (!text) return false;
      if (/^date:\s+/i.test(text)) return false;
      return true;
    })
    .slice(0, 10);
  const lines = [
    header,
    report.query ? `Query: ${report.query}` : "Source: timeline",
    `Total: ${report.entries.length} entries (showing ${top.length})`,
    ""
  ];
  top.forEach((entry, index) => {
    const author = entry.author ? `@${entry.author}` : "(anonymous)";
    const text = truncateInline(entry.text, 180);
    lines.push(`${index + 1}. ${author}`);
    lines.push(`   ${text}`);
    if (entry.url) {
      lines.push(`   ${entry.url}`);
    }
  });
  lines.push("");
  lines.push(`Source: ${report.path}`);
  const joined = lines.join("\n");
  return joined.length > 3500 ? `${joined.slice(0, 3497)}...` : joined;
}

export function classifyTelegramFreeText(text: string): "pause" | "resume" | "status" | "artist_inbox" {
  const normalized = text.toLowerCase();
  if (normalized.includes("pause")) {
    return "pause";
  }
  if (normalized.includes("resume")) {
    return "resume";
  }
  if (normalized.includes("status")) {
    return "status";
  }
  return "artist_inbox";
}

export async function storeTelegramInbox(root: string, value: Record<string, unknown>): Promise<void> {
  const path = inboxPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readTelegramInbox(root: string): Promise<Record<string, unknown>[]> {
  const contents = await readFile(inboxPath(root), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
