import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InstagramConnector } from "../connectors/social/instagramConnector.js";
import { TikTokConnector } from "../connectors/social/tiktokConnector.js";
import { XBirdConnector } from "../connectors/social/xBirdConnector.js";
import { BrowserWorkerSunoConnector } from "../connectors/suno/browserWorkerConnector.js";
import { safeRegisterRoute } from "../pluginApi.js";
import { startRuntimeEventLedgerFromEnv, startTelegramNotifierFromEnv } from "../services/index.js";
import { acknowledgeAlert } from "../services/alertAcks.js";
import { collectAlerts } from "../services/alerts.js";
import { appendAuditLog, createAuditEvent } from "../services/auditLog.js";
import { listSongStates, readArtistMind, readSongState, updateSongState } from "../services/artistState.js";
import { ArtistAutopilotService, PRODUCER_REVIEW_PAUSED_REASON, PRODUCER_REVIEW_SUSPENDED_AT, pauseAutopilot, readAutopilotRunState, resumeAutopilot, stageFromSong, writeAutopilotRunState } from "../services/autopilotService.js";
import { AutopilotControlService } from "../services/autopilotControlService.js";
import { getAutopilotTicker, getAutopilotTickerIntervalMs, getLastOutcome, getLastTickAt } from "../services/autopilotTicker.js";
import { readBirdLedgerDetail, readBirdRateLimitStatus } from "../services/birdRateLimiter.js";
import { appendCallbackAuditEvent, describeCallbackActionEffect, listPendingCallbackActionSummaries, readCallbackActionEntries, resolveCallbackAction, summarizePendingCallbackActions, type CallbackActionEntry } from "../services/callbackActionRegistry.js";
import { buildCascadeTrace } from "../services/cascadeTrace.js";
import { handleProposalResponse, listPendingProposalDetails, listPendingProposals } from "../services/conversationalSession.js";
import { composeDraftBoxNextAction } from "../services/draftBoxNextAction.js";
import { readReceiveHealth } from "../services/receiveHealthService.js";
import { buildPlatformStats, readDistributionEvents } from "../services/distributionLedgerReader.js";
import { emitRuntimeEvent, getRuntimeEventBus } from "../services/runtimeEventBus.js";
import { readRuntimeEvents, readSongEventsAsc } from "../services/runtimeEventsLedger.js";
import { appendFailedNotifyReplayRecord, latestFailedNotifyEntry, listUnreplayedFailedNotifications, summarizeFailedNotifications } from "../services/failedNotifyLedger.js";
import { getSongPromptLedgerPath } from "../services/promptLedger.js";
import { getBirdDailyMaxOverride, getBirdMinIntervalMinutesOverride, getSunoDailyBudgetOverride, isDebugCallbackDispatchEnabled, isDebugNotifyReviewEnabled, mergeResolvedConfig, patchResolvedConfig, readConfigOverrides, resolveRuntimeConfig, resolveSunoDailyBudget, writeRuntimeSafetyOverrides, type RuntimeSafetyOverridesPatch } from "../services/runtimeConfig.js";
import { publishSocialAction, readLatestSocialAction } from "../services/socialPublishing.js";
import { SocialDistributionWorker } from "../services/socialDistributionWorker.js";
import { listPendingSpawnProposals } from "../services/spawnProposalQueue.js";
import { buildEffectiveDryRunMap, resolvePlatformSocialDryRun } from "../services/socialDryRunResolver.js";
import { prepareSocialAssets } from "../services/socialAssets.js";
import { readDistributionDetectionState } from "../services/songDistributionPoller.js";
import { secretLikePattern } from "../services/personaMigrator.js";
import { handleSongPublishActionRequest } from "../services/songPublishActionRegistry.js";
import { buildSunoArtifactsPage, STATUS_SUNO_ARTIFACT_LIMIT } from "../services/sunoArtifacts.js";
import { SunoBudgetTracker } from "../services/sunoBudget.js";
import { readBudgetDetail as readSunoDailyBudgetDetail, readBudgetState as readSunoDailyBudgetState } from "../services/sunoBudgetLedger.js";
import { readLatestPromptPackMetadata } from "../services/sunoPromptPackFiles.js";
import { buildSunoArtifactIndex, generateSunoRun, readAllSunoRuns, readLatestSunoRun } from "../services/sunoRuns.js";
import { SunoBrowserWorker, workerImportOutcomeFromSong } from "../services/sunoBrowserWorker.js";
import { createSongIdea } from "../services/songIdeation.js";
import { buildSongbookLookup, syncSongbookFromITunes } from "../services/songbookSyncer.js";
import { readTakeHistory, selectTake } from "../services/takeSelection.js";
import { routeTelegramCallback } from "../services/telegramCallbackHandler.js";
import type { TelegramClient } from "../services/telegramClient.js";
import { TelegramNotifier } from "../services/telegramNotifier.js";
import { exportWindowFromPayload, integerFromPayloadOrQuery, isLocalRoutePayload, optionalInteger, payloadInteger, payloadPathSegments, payloadRecord, payloadRequestMethod, payloadRequestPath, platformFromSegment, queryValueFromPayload, sunoDiagnosticsDaysFromPayload } from "./payloadHelpers.js";
import { serializeRuntimeEventForSse, registerRuntimeEventStreamRoute } from "./runtimeEventStream.js";
import { producerConsoleHtml } from "./uiFallback.js";
import type {
  ArtistRuntimeConfig,
  DistributionSummary,
  MusicSummary,
  PlatformStatus,
  PromptLedgerEntry,
  SetupChecklistItem,
  SetupReadiness,
  SocialPlatform,
  SocialPublishLedgerEntry,
  SongState,
  StatusResponse,
  StatusExportResponse,
  ObservabilityExportWindow,
  SunoStatusResponse,
  SunoWorkerStatus,
  SunoRunRecord,
  SunoDiagnosticsExportResponse,
  SunoDiagnosticsImportOutcome
} from "../types.js";

export { producerConsoleHtml, uiBuildIsFresh } from "./uiFallback.js";

function logRouteFallback(reason: string, path: string, error?: unknown): void {
  const detail = error instanceof Error ? ` (${error.name})` : "";
  console.warn(`[artist-runtime] route fallback ${reason}: ${path}${detail}`);
}

async function readTextOrFallback(path: string, fallback: string, reason: string, logLevel: "warn" | "debug" = "warn"): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (logLevel === "warn") {
      logRouteFallback(reason, path, error);
    } else {
      console.debug(`[artist-runtime] route fallback ${reason}: ${path}`);
    }
    return fallback;
  }
}

async function readJsonOrFallback<T>(path: string, fallback: T, reason: string, logLevel: "warn" | "debug" = "debug"): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (logLevel === "warn") {
      logRouteFallback(reason, path, error);
    } else {
      console.debug(`[artist-runtime] route fallback ${reason}: ${path}`);
    }
    return fallback;
  }
}

async function readJsonlEntries<T>(path: string): Promise<T[]> {
  const contents = await readTextOrFallback(path, "", "jsonl_read_fallback", "debug");
  if (!contents) {
    return [];
  }
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function todayKey(value: string): string {
  return value.slice(0, 10);
}

const internalCallbackTelegramClient: TelegramClient = {
  answerCallbackQuery: async () => true,
  editMessageReplyMarkup: async () => true,
  editMessageText: async () => true,
  sendMessage: async (chatId: number | string) => ({ message_id: 0, chat: { id: Number(chatId) } })
} as unknown as TelegramClient;

const INSTAGRAM_TOKEN_EXPIRY_WARN_MS = 30 * 24 * 60 * 60 * 1000;
const INSTAGRAM_DEFAULT_TOKEN_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000;

function isInstagramTokenExpiringSoon(expiresAt: number | undefined, now = Date.now()): boolean {
  return typeof expiresAt === "number" && expiresAt - now <= INSTAGRAM_TOKEN_EXPIRY_WARN_MS;
}

function filterEventsByExportWindow<T extends { timestamp: string }>(
  events: T[],
  window: ObservabilityExportWindow,
  now = new Date()
): T[] {
  if (window === "all") {
    return events;
  }

  const days = window === "30d" ? 30 : 7;
  const earliest = now.getTime() - days * 24 * 60 * 60 * 1000;
  return events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return Number.isFinite(timestamp) && timestamp >= earliest && timestamp <= now.getTime();
  });
}

async function readAllSocialActions(workspaceRoot: string): Promise<SocialPublishLedgerEntry[]> {
  const songs = await listSongStates(workspaceRoot);
  const all = await Promise.all(
    songs.map((song) => readJsonlEntries<SocialPublishLedgerEntry>(join(workspaceRoot, "songs", song.songId, "social", "social-publish.jsonl")))
  );
  return all.flat().sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

async function readAllAuditEvents(workspaceRoot: string) {
  const songs = await listSongStates(workspaceRoot);
  const all = await Promise.all(
    songs.map((song) =>
      readJsonlEntries<Record<string, unknown> & { timestamp: string }>(
        join(workspaceRoot, "songs", song.songId, "audit", "actions.jsonl")
      ).then((entries) => entries.map((entry) => ({ ...entry, songId: song.songId })))
    )
  );
  return all.flat().sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

async function buildPlatformStatuses(config: ArtistRuntimeConfig): Promise<Record<SocialPlatform, PlatformStatus>> {
  const xConnector = new XBirdConnector();
  const instagramConnector = new InstagramConnector();
  const tiktokConnector = new TikTokConnector();
  const actions = await readAllSocialActions(config.artist.workspaceRoot);
  const today = todayKey(new Date().toISOString());
  const summarize = (platform: SocialPlatform) => {
    const filtered = actions.filter((action) => action.platform === platform);
    const todayFiltered = filtered.filter((action) => todayKey(action.timestamp) === today);
    return {
      postsToday: todayFiltered.filter((action) => action.action === "publish").length,
      repliesToday: todayFiltered.filter((action) => action.action === "reply").length,
      lastAction: filtered[0]
    };
  };
  const xConnection = await xConnector.checkConnection();
  const instagramConnection = await instagramConnector.checkConnection();
  const tiktokConnection = await tiktokConnector.checkConnection();
  const xSummary = summarize("x");
  const instagramSummary = summarize("instagram");
  const tiktokSummary = summarize("tiktok");

  return {
    x: {
      connected: xConnection.connected,
      authority: config.distribution.platforms.x.authority,
      authStatus: config.distribution.platforms.x.authStatus,
      lastTestedAt: config.distribution.platforms.x.lastTestedAt,
      liveGoArmed: config.distribution.platforms.x.liveGoArmed,
      effectiveDryRun: resolvePlatformSocialDryRun(config, "x"),
      capabilitySummary: await xConnector.checkCapabilities(),
      accountLabel: xConnection.accountLabel,
      reason: xConnection.reason,
      postsToday: xSummary.postsToday,
      repliesToday: xSummary.repliesToday,
      lastAction: xSummary.lastAction
    },
    instagram: {
      connected: instagramConnection.connected,
      authority: config.distribution.platforms.instagram.authority,
      authStatus: config.distribution.platforms.instagram.authStatus,
      lastTestedAt: config.distribution.platforms.instagram.lastTestedAt,
      liveGoArmed: config.distribution.platforms.instagram.liveGoArmed,
      effectiveDryRun: resolvePlatformSocialDryRun(config, "instagram"),
      capabilitySummary: await instagramConnector.checkCapabilities(),
      accountLabel: instagramConnection.accountLabel,
      reason: instagramConnection.reason,
      instagramTokenExpiringSoon: isInstagramTokenExpiringSoon(config.distribution.platforms.instagram.accessTokenExpiresAt),
      postsToday: instagramSummary.postsToday,
      repliesToday: instagramSummary.repliesToday,
      lastAction: instagramSummary.lastAction
    },
    tiktok: {
      connected: tiktokConnection.connected,
      authority: config.distribution.platforms.tiktok.authority,
      authStatus: "unconfigured",
      lastTestedAt: undefined,
      liveGoArmed: config.distribution.platforms.tiktok.liveGoArmed,
      effectiveDryRun: resolvePlatformSocialDryRun(config, "tiktok"),
      capabilitySummary: await tiktokConnector.checkCapabilities(),
      accountLabel: tiktokConnection.accountLabel,
      reason: tiktokConnection.reason,
      postsToday: tiktokSummary.postsToday,
      repliesToday: tiktokSummary.repliesToday,
      lastAction: tiktokSummary.lastAction
    }
  };
}

async function buildWorkspaceSummaries(workspaceRoot: string): Promise<Pick<StatusResponse, "recentSong" | "lastSunoRun" | "lastSocialAction">> {
  const recentSong = (await listSongStates(workspaceRoot))[0];
  if (!recentSong) {
    return {};
  }

  return {
    recentSong,
    lastSunoRun: await readLatestSunoRun(workspaceRoot, recentSong.songId),
    lastSocialAction: await readLatestSocialAction(workspaceRoot, recentSong.songId)
  };
}

function importOutcomeTime(outcome?: { at: string }): number {
  if (!outcome?.at) {
    return 0;
  }
  const parsed = Date.parse(outcome.at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function workerImportOutcomeFromRecentSong(song?: SongState): SunoWorkerStatus["lastImportOutcome"] {
  const outcome = song?.lastImportOutcome;
  if (!outcome) {
    return undefined;
  }
  return workerImportOutcomeFromSong(outcome);
}

function hasImportedAssetEvidence(outcome: SunoWorkerStatus["lastImportOutcome"]): boolean {
  return Boolean(
    outcome
    && (
      outcome.urlCount > 0
      || (outcome.pathCount ?? 0) > 0
      || (outcome.paths?.length ?? 0) > 0
      || (outcome.metadata?.length ?? 0) > 0
    )
  );
}

function isFailureImportOutcome(outcome: SunoWorkerStatus["lastImportOutcome"]): boolean {
  if (!outcome) {
    return false;
  }
  const reason = (outcome.reason ?? "").toLowerCase();
  return Boolean(
    outcome.failedUrls?.length
    || reason.includes("no_urls")
    || reason.includes("failed")
    || reason.includes("error")
    || reason.includes("not_ready")
    || reason.includes("missing")
  );
}

function withRecentSongImportOutcome(worker: SunoWorkerStatus, recentSong?: SongState): SunoWorkerStatus {
  const recentOutcome = workerImportOutcomeFromRecentSong(recentSong);
  if (!recentOutcome) {
    return worker;
  }

  const workerOutcome = worker.lastImportOutcome;
  const recentHasImportEvidence = hasImportedAssetEvidence(recentOutcome);
  const shouldSupersede = recentHasImportEvidence
    && (
      !workerOutcome
      || isFailureImportOutcome(workerOutcome)
      || (!hasImportedAssetEvidence(workerOutcome) && importOutcomeTime(recentOutcome) >= importOutcomeTime(workerOutcome))
    );
  if (!shouldSupersede) {
    return worker;
  }

  return {
    ...worker,
    lastImportOutcome: recentOutcome,
    lastImportedRunId: recentOutcome.runId
  };
}

function buildTickerStatus(config: ArtistRuntimeConfig): StatusResponse["ticker"] {
  return {
    lastOutcome: getLastOutcome(),
    lastTickAt: getLastTickAt(),
    intervalMs: getAutopilotTickerIntervalMs(config)
  };
}

async function fileHasContent(path: string): Promise<boolean> {
  const contents = await readTextOrFallback(path, "", "setup_file_read_fallback", "debug");
  return contents.trim().length > 0;
}

async function buildSetupReadiness(
  config: ArtistRuntimeConfig,
  autopilot: StatusResponse["autopilot"],
  sunoWorker: StatusResponse["sunoWorker"],
  platforms: Record<SocialPlatform, PlatformStatus>,
  workspaceStatus: Pick<StatusResponse, "recentSong" | "lastSunoRun" | "lastSocialAction">
): Promise<SetupReadiness> {
  const workspaceRoot = config.artist.workspaceRoot;
  const enabledPlatforms = (Object.entries(config.distribution.platforms) as Array<[SocialPlatform, ArtistRuntimeConfig["distribution"]["platforms"][SocialPlatform]]>)
    .filter(([, platformConfig]) => platformConfig.enabled)
    .map(([platform]) => platform);
  const artistProfileReady = await Promise.all([
    fileHasContent(join(workspaceRoot, "ARTIST.md")),
    fileHasContent(join(workspaceRoot, "SOUL.md")),
    fileHasContent(join(workspaceRoot, "artist", "SOCIAL_VOICE.md")),
    fileHasContent(join(workspaceRoot, "artist", "RELEASE_POLICY.md"))
  ]).then((values) => values.every(Boolean));
  const selectedPlatformsConnected = enabledPlatforms.length > 0 && enabledPlatforms.every((platform) => platforms[platform].connected);
  const budgetsReady = config.autopilot.cycleIntervalMinutes > 0
    && config.autopilot.songsPerWeek > 0
    && config.music.suno.monthlyGenerationBudget > 0
    && config.music.suno.maxGenerationsPerDay > 0;
  const hardStopsConfirmed = config.safety.failClosed
    && config.music.suno.stopOnLoginChallenge
    && config.music.suno.stopOnCaptcha
    && config.music.suno.stopOnPaymentPrompt;
  const dryRunCycleCompleted = Boolean(
    workspaceStatus.recentSong
    || workspaceStatus.lastSunoRun
    || workspaceStatus.lastSocialAction
    || autopilot.currentRunId
    || autopilot.lastSuccessfulStage
  );

  const checklist: SetupChecklistItem[] = [
    {
      id: "create_artist",
      label: "Create artist",
      state: artistProfileReady ? "complete" : "pending",
      detail: artistProfileReady
        ? "ARTIST.md, SOUL.md, SOCIAL_VOICE, and RELEASE_POLICY are present."
        : "Finish the artist constitution and voice files in the workspace template."
    },
    {
      id: "choose_platforms",
      label: "Choose platforms",
      state: enabledPlatforms.length > 0 ? "complete" : "pending",
      detail: enabledPlatforms.length > 0
        ? `Selected: ${enabledPlatforms.join(", ")}`
        : "Enable at least one public platform for daily sharing."
    },
    {
      id: "connect_suno",
      label: "Connect Suno",
      state: sunoWorker.connected ? "complete" : "pending",
      detail: sunoWorker.connected
        ? "Suno browser worker is connected."
        : sunoWorker.pendingAction ?? "Request operator login and keep the worker profile alive."
    },
    {
      id: "connect_social",
      label: "Connect selected social platforms",
      state: enabledPlatforms.length === 0 ? "pending" : selectedPlatformsConnected ? "complete" : "pending",
      detail: enabledPlatforms.length === 0
        ? "Choose platforms before checking social connections."
        : selectedPlatformsConnected
          ? "All enabled platforms report connected."
          : `Waiting on connections for ${enabledPlatforms.filter((platform) => !platforms[platform].connected).join(", ")}.`
    },
    {
      id: "budgets_and_cadence",
      label: "Choose budgets and cadence",
      state: budgetsReady ? "complete" : "attention",
      detail: budgetsReady
        ? `Cycle ${config.autopilot.cycleIntervalMinutes} min · ${config.music.suno.monthlyGenerationBudget} Suno runs/month.`
        : "Set positive cadence, weekly song target, and Suno budget limits."
    },
    {
      id: "confirm_hard_stops",
      label: "Confirm hard stops",
      state: hardStopsConfirmed ? "complete" : "attention",
      detail: hardStopsConfirmed
        ? "Fail-closed and Suno hard-stop rules are active."
        : "Turn on fail-closed mode and all Suno stop conditions."
    },
    {
      id: "run_dry_run_cycle",
      label: "Run dry-run cycle",
      state: dryRunCycleCompleted ? "complete" : "pending",
      detail: dryRunCycleCompleted
        ? `Observed via ${workspaceStatus.recentSong ? `song ${workspaceStatus.recentSong.songId}` : autopilot.currentRunId ?? "autopilot state"}.`
        : "Run one dry-run cycle to create initial song/runtime evidence."
    }
  ];

  const readyForAutopilot = checklist.every((item) => item.state === "complete");
  const autopilotLiveState: SetupChecklistItem = {
    id: "turn_on_autopilot",
    label: "Turn on autopilot",
    state: config.autopilot.enabled && !config.autopilot.dryRun
      ? readyForAutopilot ? "complete" : "attention"
      : "pending",
    detail: config.autopilot.enabled && !config.autopilot.dryRun
      ? readyForAutopilot
        ? "Live autopilot is enabled."
        : "Autopilot is live before setup is complete."
      : readyForAutopilot
        ? "Setup is ready; you can switch off dry-run and enable live autopilot."
        : "Keep dry-run on until the preceding setup items are complete."
  };
  checklist.push(autopilotLiveState);

  const completeCount = checklist.filter((item) => item.state === "complete").length;
  const nextIncomplete = checklist.find((item) => item.state !== "complete");

  return {
    completeCount,
    totalCount: checklist.length,
    readyForAutopilot,
    nextRecommendedAction: nextIncomplete?.label ?? "Setup complete",
    checklist
  };
}

export async function buildSongsResponse(config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  return listSongStates(mergedConfig.artist.workspaceRoot);
}

export async function buildSongDetailResponse(songId: string, config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  const workspaceRoot = mergedConfig.artist.workspaceRoot;
  const [state, brief, lyrics, songMarkdown, promptLedger, sunoRuns, latestSocialAction, selectedTake, socialAssets, latestPromptPack, takeHistory] = await Promise.all([
    readSongState(workspaceRoot, songId),
    readTextOrFallback(join(workspaceRoot, "songs", songId, "brief.md"), "", "song_brief_missing", "debug"),
    readTextOrFallback(join(workspaceRoot, "songs", songId, "suno", "lyrics-suno.md"), "", "song_lyrics_missing", "debug"),
    readTextOrFallback(join(workspaceRoot, "songs", songId, "song.md"), "", "song_markdown_missing", "debug"),
    readJsonlEntries<PromptLedgerEntry>(join(workspaceRoot, "songs", songId, "prompts", "prompt-ledger.jsonl")),
    readAllSunoRuns(workspaceRoot, songId),
    readLatestSocialAction(workspaceRoot, songId),
    readJsonOrFallback<unknown>(join(workspaceRoot, "songs", songId, "suno", "selected-take.json"), undefined, "selected_take_missing", "debug"),
    readJsonOrFallback<unknown[]>(join(workspaceRoot, "songs", songId, "social", "assets.json"), [], "social_assets_missing", "debug"),
    readLatestPromptPackMetadata(workspaceRoot, songId),
    readTakeHistory(workspaceRoot, songId)
  ]);

  return {
    song: state,
    brief,
    cascadeTrace: buildCascadeTrace({
      songId,
      brief,
      title: state.title,
      artistVoice: state.lastReason ?? takeHistory[0]?.reason,
      observationSummary: state.observationSummary
    }),
    lyrics,
    songMarkdown,
    promptLedger,
    sunoRuns,
    selectedTake,
    takeSelections: promptLedger.filter((entry) => entry.stage === "take_selection"),
    takeHistory,
    latestPromptPack,
    socialAssets,
    lastSocialAction: latestSocialAction
  };
}

export async function buildSongLedgerResponse(songId: string, config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  return readJsonlEntries<PromptLedgerEntry>(join(mergedConfig.artist.workspaceRoot, "songs", songId, "prompts", "prompt-ledger.jsonl"));
}

export async function buildSongEventsResponse(songId: string, config?: Partial<ArtistRuntimeConfig>, limit = 200) {
  const mergedConfig = await resolveRuntimeConfig(config);
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.min(1000, Math.floor(limit))) : 200;
  const events = await readSongEventsAsc(mergedConfig.artist.workspaceRoot, songId, safeLimit);
  return {
    events: events
      .map((event) => serializeRuntimeEventForSse(event))
      .filter((event): event is string => typeof event === "string")
      .map((event) => JSON.parse(event) as unknown)
  };
}

export async function buildPromptLedgerResponse(songId?: string, config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  if (songId) {
    return readJsonlEntries<PromptLedgerEntry>(getSongPromptLedgerPath(mergedConfig.artist.workspaceRoot, songId));
  }

  const songs = await listSongStates(mergedConfig.artist.workspaceRoot);
  const ledgers = await Promise.all(
    songs.map((song) =>
      readJsonlEntries<PromptLedgerEntry>(getSongPromptLedgerPath(mergedConfig.artist.workspaceRoot, song.songId))
        .then((entries) => entries.map((entry) => ({ ...entry, songId: entry.songId ?? song.songId })))
    )
  );
  return ledgers.flat().sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export async function buildAlertsResponse(config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  const platforms = await buildPlatformStatuses(mergedConfig);
  const sunoWorker = await new BrowserWorkerSunoConnector(mergedConfig.artist.workspaceRoot, { config: mergedConfig }).status();
  return collectAlerts(mergedConfig.artist.workspaceRoot, sunoWorker, platforms, mergedConfig);
}

function proposalFieldsFromPayload(payload: Record<string, unknown>): Record<string, string> {
  const rawFields = typeof payload.fields === "object" && payload.fields !== null
    ? payload.fields as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.entries(rawFields)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([field, value]) => [field, value])
  );
}

function payloadContainsSecretLikeText(payload: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const value = payload[key];
    return typeof value === "string" && secretLikePattern.test(value);
  });
}

function proposalRouteError(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("proposal_id_not_unique:")) {
    return {
      error: "proposal_id_not_unique",
      proposalId: message.slice("proposal_id_not_unique:".length)
    };
  }
  return {
    error: "proposal_route_failed",
    message
  };
}

export async function buildConfigResponse(config?: Partial<ArtistRuntimeConfig>) {
  return resolveRuntimeConfig(config);
}

type OverrideSource = "env" | "overrides" | "default";

interface RuntimeOverrideField {
  value: number;
  source: OverrideSource;
  editable: boolean;
  defaultValue: number;
  envVar?: string;
}

interface ConfigOverridesResponse {
  raw: Record<string, unknown>;
  values: {
    sunoDailyBudget: RuntimeOverrideField;
    birdDailyMax: RuntimeOverrideField;
    birdMinIntervalMinutes: RuntimeOverrideField;
    autopilotIntervalMinutes: RuntimeOverrideField;
  };
}

function hasOwnRecordKey(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key);
}

function runtimeOverrideField(input: {
  value: number;
  defaultValue: number;
  envVar?: string;
  envValue?: number;
  overridePresent: boolean;
}): RuntimeOverrideField {
  const source: OverrideSource = input.envValue !== undefined ? "env" : input.overridePresent ? "overrides" : "default";
  return {
    value: input.value,
    source,
    editable: source !== "env",
    defaultValue: input.defaultValue,
    envVar: input.envVar
  };
}

export async function buildConfigOverridesResponse(config?: Partial<ArtistRuntimeConfig>): Promise<ConfigOverridesResponse> {
  const mergedConfig = await resolveRuntimeConfig(config);
  const root = mergedConfig.artist.workspaceRoot;
  const raw = await readConfigOverrides(root) as Record<string, unknown> & {
    suno?: { dailyBudget?: unknown };
    bird?: { rateLimits?: { dailyMax?: unknown; minIntervalMinutes?: unknown } };
    autopilot?: { intervalMinutes?: unknown; cycleIntervalMinutes?: unknown };
  };
  const bird = await readBirdRateLimitStatus(root);
  const envSuno = getSunoDailyBudgetOverride();
  const envBirdDailyMax = getBirdDailyMaxOverride();
  const envBirdMinInterval = getBirdMinIntervalMinutesOverride();
  const autopilotOverridePresent = hasOwnRecordKey(raw.autopilot, "intervalMinutes") || hasOwnRecordKey(raw.autopilot, "cycleIntervalMinutes");

  return {
    raw,
    values: {
      sunoDailyBudget: runtimeOverrideField({
        value: await resolveSunoDailyBudget(root),
        defaultValue: 50,
        envVar: "OPENCLAW_SUNO_DAILY_BUDGET",
        envValue: envSuno,
        overridePresent: hasOwnRecordKey(raw.suno, "dailyBudget")
      }),
      birdDailyMax: runtimeOverrideField({
        value: bird.dailyMax,
        defaultValue: 5,
        envVar: "OPENCLAW_BIRD_DAILY_MAX",
        envValue: envBirdDailyMax,
        overridePresent: hasOwnRecordKey(raw.bird?.rateLimits, "dailyMax")
      }),
      birdMinIntervalMinutes: runtimeOverrideField({
        value: bird.minIntervalMinutes,
        defaultValue: 60,
        envVar: "OPENCLAW_BIRD_MIN_INTERVAL_MINUTES",
        envValue: envBirdMinInterval,
        overridePresent: hasOwnRecordKey(raw.bird?.rateLimits, "minIntervalMinutes")
      }),
      autopilotIntervalMinutes: runtimeOverrideField({
        value: mergedConfig.autopilot.cycleIntervalMinutes,
        defaultValue: 180,
        overridePresent: autopilotOverridePresent
      })
    }
  };
}

function validateRuntimeOverridePayload(payload: Record<string, unknown>): string[] {
  const allowedRoot = new Set(["requestMethod", "requestPath", "config", "suno", "bird", "autopilot"]);
  const errors: string[] = [];
  for (const key of Object.keys(payload)) {
    if (!allowedRoot.has(key)) {
      errors.push(`unknown override key: ${key}`);
    }
  }
  const suno = payload.suno as Record<string, unknown> | undefined;
  if (suno !== undefined) {
    if (typeof suno !== "object" || suno === null || Array.isArray(suno)) {
      errors.push("suno must be an object");
    } else {
      for (const key of Object.keys(suno)) {
        if (key !== "dailyBudget") {
          errors.push(`unknown override key: suno.${key}`);
        }
      }
    }
  }
  const bird = payload.bird as Record<string, unknown> | undefined;
  const rateLimits = bird?.rateLimits as Record<string, unknown> | undefined;
  if (bird !== undefined) {
    if (typeof bird !== "object" || bird === null || Array.isArray(bird)) {
      errors.push("bird must be an object");
    } else {
      for (const key of Object.keys(bird)) {
        if (key !== "rateLimits") {
          errors.push(`unknown override key: bird.${key}`);
        }
      }
      if (rateLimits !== undefined) {
        if (typeof rateLimits !== "object" || rateLimits === null || Array.isArray(rateLimits)) {
          errors.push("bird.rateLimits must be an object");
        } else {
          for (const key of Object.keys(rateLimits)) {
            if (key !== "dailyMax" && key !== "minIntervalMinutes") {
              errors.push(`unknown override key: bird.rateLimits.${key}`);
            }
          }
        }
      }
    }
  }
  const autopilot = payload.autopilot as Record<string, unknown> | undefined;
  if (autopilot !== undefined) {
    if (typeof autopilot !== "object" || autopilot === null || Array.isArray(autopilot)) {
      errors.push("autopilot must be an object");
    } else {
      for (const key of Object.keys(autopilot)) {
        if (key !== "intervalMinutes") {
          errors.push(`unknown override key: autopilot.${key}`);
        }
      }
    }
  }
  return errors;
}

function integerInRange(value: unknown, label: string, min: number, max: number, errors: string[]): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    errors.push(`${label} must be an integer between ${min} and ${max}`);
    return undefined;
  }
  return value;
}

function runtimeSafetyPatchFromPayload(payload: Record<string, unknown>): { patch?: RuntimeSafetyOverridesPatch; errors: string[] } {
  const errors = validateRuntimeOverridePayload(payload);
  const suno = payload.suno as { dailyBudget?: unknown } | undefined;
  const bird = payload.bird as { rateLimits?: { dailyMax?: unknown; minIntervalMinutes?: unknown } } | undefined;
  const autopilot = payload.autopilot as { intervalMinutes?: unknown } | undefined;
  const dailyBudget = integerInRange(suno?.dailyBudget, "suno.dailyBudget", 1, 1000, errors);
  const dailyMax = integerInRange(bird?.rateLimits?.dailyMax, "bird.rateLimits.dailyMax", 1, 100, errors);
  const minIntervalMinutes = integerInRange(bird?.rateLimits?.minIntervalMinutes, "bird.rateLimits.minIntervalMinutes", 1, 1440, errors);
  const intervalMinutes = integerInRange(autopilot?.intervalMinutes, "autopilot.intervalMinutes", 15, 1440, errors);
  if (errors.length > 0) {
    return { errors };
  }
  return {
    errors: [],
    patch: {
      ...(dailyBudget !== undefined ? { suno: { dailyBudget } } : {}),
      ...(dailyMax !== undefined || minIntervalMinutes !== undefined
        ? { bird: { rateLimits: { ...(dailyMax !== undefined ? { dailyMax } : {}), ...(minIntervalMinutes !== undefined ? { minIntervalMinutes } : {}) } } }
        : {}),
      ...(intervalMinutes !== undefined ? { autopilot: { intervalMinutes } } : {})
    }
  };
}

async function appendConfigOverridesAudit(
  workspaceRoot: string,
  before: ConfigOverridesResponse,
  after: ConfigOverridesResponse
): Promise<void> {
  await appendAuditLog(
    join(workspaceRoot, "runtime", "config-overrides-audit.jsonl"),
    createAuditEvent({
      eventType: "config_overrides_update",
      actor: "producer",
      sourceRefs: ["runtime/config-overrides.json"],
      details: {
        before: before.values,
        after: after.values
      }
    })
  );
}

export async function buildArtistMindResponse(config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  return readArtistMind(mergedConfig.artist.workspaceRoot);
}

export async function buildAuditLogResponse(config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  return readAllAuditEvents(mergedConfig.artist.workspaceRoot);
}

export async function buildRecoveryResponse(config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  const [status, audit] = await Promise.all([
    buildStatusResponse(mergedConfig),
    buildAuditLogResponse(mergedConfig)
  ]);
  return {
    autopilot: status.autopilot,
    sunoWorker: status.sunoWorker,
    distributionWorker: status.distributionWorker,
    alerts: status.alerts,
    recentAudit: audit.slice(0, 10),
    diagnostics: {
      workspaceRoot: mergedConfig.artist.workspaceRoot,
      dryRun: status.dryRun,
      recentSongId: status.recentSong?.songId,
      currentRunId: status.autopilot.currentRunId,
      currentSongId: status.autopilot.currentSongId,
      blockedReason: status.autopilot.blockedReason ?? status.distributionWorker.blockedReason ?? status.sunoWorker.hardStopReason
    }
  };
}

export async function buildPlatformsResponse(config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  return buildPlatformStatuses(mergedConfig);
}

export async function buildPlatformDetailResponse(platform: SocialPlatform, config?: Partial<ArtistRuntimeConfig>) {
  const mergedConfig = await resolveRuntimeConfig(config);
  return (await buildPlatformStatuses(mergedConfig))[platform];
}

export async function buildSunoStatusResponse(config?: Partial<ArtistRuntimeConfig>): Promise<SunoStatusResponse> {
  const mergedConfig = await resolveRuntimeConfig(config);
  const workspaceRoot = mergedConfig.artist.workspaceRoot;
  const recentSong = (await listSongStates(workspaceRoot))[0];
  const worker = withRecentSongImportOutcome(
    await new BrowserWorkerSunoConnector(workspaceRoot, { config: mergedConfig }).status(),
    recentSong
  );
  const latestPromptPack = recentSong ? await readLatestPromptPackMetadata(workspaceRoot, recentSong.songId) : undefined;
  return {
    worker,
    currentSongId: recentSong?.songId,
    latestRun: recentSong ? await readLatestSunoRun(workspaceRoot, recentSong.songId) : undefined,
    recentRuns: recentSong ? await readAllSunoRuns(workspaceRoot, recentSong.songId) : [],
    latestPromptPackVersion: latestPromptPack?.version,
    latestPromptPackMetadata: latestPromptPack?.metadata,
    artifacts: (await buildSunoArtifactIndex(workspaceRoot)).slice(0, STATUS_SUNO_ARTIFACT_LIMIT),
    currentRunId: worker.currentRunId,
    lastImportedRunId: worker.lastImportedRunId,
    lastCreateOutcome: worker.lastCreateOutcome,
    lastImportOutcome: worker.lastImportOutcome
  };
}

async function buildMusicSummary(config: ArtistRuntimeConfig): Promise<MusicSummary> {
  const songs = await listSongStates(config.artist.workspaceRoot);
  const runs = (
    await Promise.all(
      songs.map((song) => readJsonlEntries<SunoRunRecord>(join(config.artist.workspaceRoot, "songs", song.songId, "suno", "runs.jsonl")))
    )
  ).flat();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const today = todayKey(new Date().toISOString());
  const recentSong = songs[0];
  const latestPromptPack = recentSong ? await readLatestPromptPackMetadata(config.artist.workspaceRoot, recentSong.songId) : undefined;
  return {
    monthlyGenerationBudget: config.music.suno.monthlyGenerationBudget,
    monthlyRuns: runs.filter((run) => run.createdAt.startsWith(currentMonth)).length,
    dailyRuns: runs.filter((run) => todayKey(run.createdAt) === today).length,
    latestPromptPackVersion: latestPromptPack?.version,
    latestPromptPackMetadata: latestPromptPack?.metadata,
    latestPromptPackCharCounts: latestPromptPack?.metadata.charCounts as MusicSummary["latestPromptPackCharCounts"] | undefined
  };
}

async function buildDistributionSummary(config: ArtistRuntimeConfig, platforms: Record<SocialPlatform, PlatformStatus>): Promise<DistributionSummary> {
  const actions = await readAllSocialActions(config.artist.workspaceRoot);
  const today = todayKey(new Date().toISOString());
  const todayActions = actions.filter((action) => todayKey(action.timestamp) === today);
  const lastAction = actions[0];
  return {
    postsToday: todayActions.filter((action) => action.action === "publish").length,
    repliesToday: todayActions.filter((action) => action.action === "reply").length,
    lastPlatform: lastAction?.platform,
    lastPostUrl: lastAction?.url ?? platforms.x.lastAction?.url ?? platforms.instagram.lastAction?.url ?? platforms.tiktok.lastAction?.url
  };
}

export async function buildStatusResponse(config?: Partial<ArtistRuntimeConfig>): Promise<StatusResponse> {
  const mergedConfig = await resolveRuntimeConfig(config);
  const autopilot = await new ArtistAutopilotService().status(
    mergedConfig.autopilot.enabled,
    mergedConfig.autopilot.dryRun,
    mergedConfig.artist.workspaceRoot
  );
  const rawSunoWorker = await new BrowserWorkerSunoConnector(mergedConfig.artist.workspaceRoot, { config: mergedConfig }).status();
  const distributionWorker = await new SocialDistributionWorker().status(mergedConfig);
  const workspaceStatus = await buildWorkspaceSummaries(mergedConfig.artist.workspaceRoot);
  const sunoWorker = withRecentSongImportOutcome(rawSunoWorker, workspaceStatus.recentSong);
  const draftBoxAction = await composeDraftBoxNextAction(mergedConfig.artist.workspaceRoot).catch(() => undefined);
  const autopilotStatus = draftBoxAction
    ? { ...autopilot, nextAction: draftBoxAction.nextAction }
    : autopilot;
  const platforms = await buildPlatformStatuses(mergedConfig);
  const alerts = await collectAlerts(mergedConfig.artist.workspaceRoot, sunoWorker, platforms, mergedConfig);
  const sunoBudgetTracker = new SunoBudgetTracker(mergedConfig.artist.workspaceRoot);
  const [sunoBudgetState, sunoBudgetResetHistory, sunoArtifacts, sunoDailyBudget, sunoBudgetDetail, birdRateLimit, birdLedger, distributionDetection, pendingApprovals, pendingCallbacks, failedNotifications] = await Promise.all([
    sunoBudgetTracker.getState(
      mergedConfig.music.suno.dailyCreditLimit,
      mergedConfig.music.suno.monthlyCreditLimit
    ),
    sunoBudgetTracker.getResetHistory(10),
    buildSunoArtifactIndex(mergedConfig.artist.workspaceRoot),
    readSunoDailyBudgetState(mergedConfig.artist.workspaceRoot),
    readSunoDailyBudgetDetail(mergedConfig.artist.workspaceRoot),
    readBirdRateLimitStatus(mergedConfig.artist.workspaceRoot),
    readBirdLedgerDetail(mergedConfig.artist.workspaceRoot),
    readDistributionDetectionState(mergedConfig.artist.workspaceRoot),
    listPendingProposals(mergedConfig.artist.workspaceRoot),
    summarizePendingCallbackActions(mergedConfig.artist.workspaceRoot, 8),
    summarizeFailedNotifications(mergedConfig.artist.workspaceRoot, 8)
  ]);
  const [musicSummary, distributionSummary] = await Promise.all([
    buildMusicSummary(mergedConfig),
    buildDistributionSummary(mergedConfig, platforms)
  ]);
  const [recentDistributionEvents, platformStats, runtimeEventsLedger, telegramInbound] = await Promise.all([
    readDistributionEvents(mergedConfig.artist.workspaceRoot, 20),
    buildPlatformStats(mergedConfig.artist.workspaceRoot),
    readRuntimeEvents(mergedConfig.artist.workspaceRoot, 20),
    readReceiveHealth(mergedConfig.artist.workspaceRoot)
  ]);
  const setupReadiness = await buildSetupReadiness(mergedConfig, autopilotStatus, sunoWorker, platforms, workspaceStatus);
  const effectiveDryRunMap = buildEffectiveDryRunMap(mergedConfig);
  const rawConfigOverrides = await readConfigOverrides(mergedConfig.artist.workspaceRoot) as { suno?: { dailyBudget?: unknown } };
  const hasRuntimeSunoBudget = getSunoDailyBudgetOverride() !== undefined
    || hasOwnRecordKey(rawConfigOverrides.suno, "dailyBudget");
  const statusSunoBudget = hasRuntimeSunoBudget
    ? {
        ...sunoBudgetState,
        limit: sunoDailyBudget.limit,
        remaining: Math.max(0, sunoDailyBudget.limit - sunoBudgetState.consumed),
        used: sunoDailyBudget.used,
        resetHistory: sunoBudgetResetHistory
      }
    : {
        ...sunoBudgetState,
        used: sunoDailyBudget.used,
        resetHistory: sunoBudgetResetHistory
      };

  return {
    config: mergedConfig,
    dryRun: mergedConfig.autopilot.dryRun,
    summary: {
      allPlatformsEffectivelyDryRun: Object.values(effectiveDryRunMap).every(Boolean),
      effectiveDryRunMap
    },
    autopilot: autopilotStatus,
    ticker: buildTickerStatus(mergedConfig),
    suno: {
      budget: statusSunoBudget,
      budgetDetail: sunoBudgetDetail,
      artifacts: sunoArtifacts.slice(0, STATUS_SUNO_ARTIFACT_LIMIT),
      profile: {
        stale: sunoWorker.sunoProfileStale,
        detail: sunoWorker.sunoProfileDetail,
        checkedAt: sunoWorker.sunoProfileCheckedAt
      }
    },
    sunoWorker,
    distributionWorker,
    bird: {
      rateLimit: birdRateLimit,
      ledger: birdLedger
    },
    distribution: {
      detected: distributionDetection.detected
    },
    pendingApprovals: {
      count: pendingApprovals.length,
      recent: pendingApprovals.slice(0, 3)
    },
    pendingCallbacks,
    failedNotifications,
    platforms,
    musicSummary,
    distributionSummary,
    recentDistributionEvents,
    platformStats,
    runtimeEvents: [
      ...getRuntimeEventBus().listRecent(20),
      ...runtimeEventsLedger
    ].slice(0, 20),
    setupReadiness,
    alerts,
    recentSong: workspaceStatus.recentSong,
    lastSunoRun: workspaceStatus.lastSunoRun,
    lastSocialAction: workspaceStatus.lastSocialAction,
    telegramInbound
  };
}

export async function buildSunoDiagnosticsExportResponse(
  config?: Partial<ArtistRuntimeConfig>,
  days = 7,
  now = new Date()
): Promise<SunoDiagnosticsExportResponse> {
  const mergedConfig = await resolveRuntimeConfig(config);
  const workspaceRoot = mergedConfig.artist.workspaceRoot;
  const cutoffMs = now.getTime() - Math.min(30, Math.max(1, days)) * 24 * 60 * 60 * 1000;
  const worker = await new BrowserWorkerSunoConnector(workspaceRoot, { config: mergedConfig }).status();
  const [resetHistory, songs] = await Promise.all([
    new SunoBudgetTracker(workspaceRoot).getResetHistory(Number.MAX_SAFE_INTEGER),
    listSongStates(workspaceRoot)
  ]);
  const inWindow = (timestamp: string) => {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) && parsed >= cutoffMs && parsed <= now.getTime();
  };
  const importOutcomes: SunoDiagnosticsImportOutcome[] = songs.flatMap((song) =>
    song.lastImportOutcome ? [{ songId: song.songId, ...song.lastImportOutcome }] : []
  );

  return {
    generatedAt: now.toISOString(),
    days: Math.min(30, Math.max(1, days)),
    profile: {
      state: worker.state,
      connected: worker.connected,
      stale: worker.sunoProfileStale,
      detail: worker.sunoProfileDetail,
      checkedAt: worker.sunoProfileCheckedAt
    },
    budgetResetHistory: resetHistory
      .filter((entry) => inWindow(entry.timestamp))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    importOutcomes: importOutcomes
      .filter((outcome) => inWindow(outcome.at))
      .sort((left, right) => right.at.localeCompare(left.at))
  };
}

export interface InternalCallbackDispatchResponse {
  dispatched: boolean;
  callbackId?: string;
  action?: string;
  result?: string;
  reason?: string;
  error?: string;
  statusCode: number;
}

export async function buildInternalCallbackDispatchResponse(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env
): Promise<InternalCallbackDispatchResponse> {
  const payload = payloadRecord(input);
  if (!isDebugCallbackDispatchEnabled(env)) {
    return { dispatched: false, error: "debug_callback_dispatch_disabled", statusCode: 403 };
  }
  if (!isLocalRoutePayload(payload)) {
    return { dispatched: false, error: "debug_callback_dispatch_not_local", statusCode: 403 };
  }

  const callbackId = typeof payload.callbackId === "string" ? payload.callbackId.trim() : "";
  if (!callbackId) {
    return { dispatched: false, error: "invalid_callback_id", statusCode: 400 };
  }

  const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
  const entry = await resolveCallbackAction(config.artist.workspaceRoot, callbackId);
  if (!entry || entry.status !== "pending") {
    return { dispatched: false, callbackId, error: "callback_action_not_pending", statusCode: 404 };
  }

  const chatId = optionalInteger(payload.chatId) ?? entry.chatId;
  const userId = optionalInteger(payload.userId) ?? entry.userId;
  const messageId = optionalInteger(payload.messageId) ?? entry.messageId;
  const result = await routeTelegramCallback({
    root: config.artist.workspaceRoot,
    client: internalCallbackTelegramClient,
    callbackQueryId: `internal:${callbackId}`,
    data: `cb:${callbackId}`,
    fromUserId: userId,
    chatId,
    messageId,
    actor: "internal_recovery"
  });
  if (result.result === "unauthorized") {
    return { dispatched: false, callbackId, action: entry.action, result: result.result, reason: result.reason, statusCode: 403 };
  }
  if (result.result === "failed") {
    return { dispatched: false, callbackId, action: entry.action, result: result.result, reason: result.reason, statusCode: 400 };
  }
  return { dispatched: true, callbackId, action: entry.action, result: result.result, reason: result.reason, statusCode: 200 };
}

/**
 * Plan v10.65 Layer 2 — receive-independent escape.
 *
 * The spawn GO (`song_spawn_inject`/`song_spawn_skip`) and Suno pre-GO
 * (`prompt_pack_go`) decisions were Telegram-callback-only. If Telegram receive
 * dies, the producer could see proposals (GET) but had no way to act. These
 * actions are now drivable from the Producer Console via an explicit operator
 * click (actor "ui_api"), reusing the SAME callback handler as Telegram so the
 * inject/state-flip/audit logic lives in exactly one place.
 *
 * R10: this set is an airtight allowlist. Any publish/social callback id is
 * rejected here BEFORE dispatch — the Console can never fire an external post,
 * independent of the downstream actor guards.
 */
const PRODUCER_UI_DISPATCH_ALLOWLIST: ReadonlySet<string> = new Set([
  "song_spawn_inject",
  "song_spawn_skip",
  "prompt_pack_go"
]);

export interface ProducerCallbackDispatchResponse {
  dispatched: boolean;
  callbackId?: string;
  action?: string;
  result?: string;
  reason?: string;
  error?: string;
  statusCode: number;
}

async function findLatestPendingCallback(
  root: string,
  match: { action: string; proposalId?: string; songId?: string }
): Promise<CallbackActionEntry | undefined> {
  const entries = await readCallbackActionEntries(root);
  // Duplicate callbacks exist in this codebase (resurface/re-emit/stale-queue);
  // pick the newest pending match deterministically so we never dispatch a stale row.
  return entries
    .filter((entry) => entry.status === "pending" && entry.action === match.action)
    .filter((entry) => (match.proposalId ? entry.proposalId === match.proposalId : true))
    .filter((entry) => (match.songId ? entry.songId === match.songId : true))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export async function buildProducerCallbackDispatchResponse(
  workspaceRoot: string,
  match: { action: string; proposalId?: string; songId?: string }
): Promise<ProducerCallbackDispatchResponse> {
  if (!PRODUCER_UI_DISPATCH_ALLOWLIST.has(match.action)) {
    return { dispatched: false, action: match.action, error: "action_not_allowed_from_console", statusCode: 403 };
  }
  const entry = await findLatestPendingCallback(workspaceRoot, match);
  if (!entry) {
    return { dispatched: false, action: match.action, error: "pending_callback_not_found", statusCode: 404 };
  }
  const result = await routeTelegramCallback({
    root: workspaceRoot,
    client: internalCallbackTelegramClient,
    callbackQueryId: `ui_api:${entry.callbackId}`,
    data: `cb:${entry.callbackId}`,
    fromUserId: entry.userId,
    chatId: entry.chatId,
    messageId: entry.messageId,
    actor: "ui_api"
  });
  if (result.result === "unauthorized") {
    return { dispatched: false, callbackId: entry.callbackId, action: entry.action, result: result.result, reason: result.reason, statusCode: 403 };
  }
  if (result.result === "failed") {
    return { dispatched: false, callbackId: entry.callbackId, action: entry.action, result: result.result, reason: result.reason, statusCode: 400 };
  }
  return { dispatched: true, callbackId: entry.callbackId, action: entry.action, result: result.result, reason: result.reason, statusCode: 200 };
}

export interface NotifyReviewResponse {
  notified: boolean;
  songId?: string;
  selectedTakeId?: string;
  eventType?: "song_take_completed";
  reason?: string;
  revertedFrom?: SongState["status"];
  statusCode: number;
}

export async function buildNotifyReviewResponse(
  input: unknown,
  songId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<NotifyReviewResponse> {
  const payload = payloadRecord(input);
  if (!isDebugNotifyReviewEnabled(env)) {
    return { notified: false, songId, reason: "debug_notify_review_disabled", statusCode: 403 };
  }
  const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
  const root = config.artist.workspaceRoot;
  const song = await readSongState(root, songId).catch(() => undefined);
  if (!song) {
    return { notified: false, songId, reason: "song_not_in_take_selected", statusCode: 400 };
  }
  const canReopenReview = song.status === "social_assets" || song.status === "publishing";
  if (song.status !== "take_selected" && !canReopenReview) {
    return { notified: false, songId, reason: "song_not_in_take_selected", statusCode: 400 };
  }
  if (!song.selectedTakeId) {
    return { notified: false, songId, reason: "song_review_selected_take_missing", statusCode: 400 };
  }
  const now = Date.now();
  const revertedFrom = canReopenReview ? song.status : undefined;
  const reviewSong = revertedFrom
    ? await updateSongState(root, songId, {
      status: "take_selected",
      reason: `producer_review_reopened_from:${revertedFrom}`
    })
    : song;
  const current = await readAutopilotRunState(root).catch(() => undefined);
  if (current) {
    await writeAutopilotRunState(root, {
      ...current,
      currentSongId: songId,
      stage: "take_selection",
      paused: true,
      pausedReason: PRODUCER_REVIEW_PAUSED_REASON,
      suspendedAt: PRODUCER_REVIEW_SUSPENDED_AT,
      blockedReason: PRODUCER_REVIEW_SUSPENDED_AT,
      lastError: undefined,
      lastSuccessfulStage: "take_selection",
      updatedAt: new Date(now).toISOString()
    });
  }
  if (revertedFrom) {
    await appendCallbackAuditEvent(root, {
      timestamp: now,
      action: "notify_review_reopened",
      songId,
      result: "reopened",
      reason: `producer_review_reopened_from:${revertedFrom}`,
      actor: "manual_notify_retrigger"
    });
  }
  await startTelegramNotifierFromEnv(env);
  startRuntimeEventLedgerFromEnv(env);
  emitRuntimeEvent({
    type: "song_take_completed",
    songId,
    selectedTakeId: reviewSong.selectedTakeId,
    urls: reviewSong.publicLinks,
    actor: "manual_notify_retrigger",
    timestamp: now
  });
  await appendCallbackAuditEvent(root, {
    timestamp: now,
    action: "notify_review_retriggered",
    songId,
    result: "notified",
    reason: "notify_review_retriggered",
    actor: "manual_notify_retrigger"
  });
  return {
    notified: true,
    songId,
    selectedTakeId: reviewSong.selectedTakeId,
    eventType: "song_take_completed",
    reason: "notify_review_retriggered",
    revertedFrom,
    statusCode: 200
  };
}

export interface FailedNotifyListResponse {
  count: number;
  failed: Awaited<ReturnType<typeof listUnreplayedFailedNotifications>>;
}

export async function buildFailedNotifyListResponse(input: unknown): Promise<FailedNotifyListResponse> {
  const payload = payloadRecord(input);
  const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
  const failed = await listUnreplayedFailedNotifications(config.artist.workspaceRoot, {
    limit: payloadInteger(payload, "limit", 20),
    since: typeof payload.since === "string" ? payload.since : undefined
  });
  return {
    count: failed.length,
    failed
  };
}

export interface FailedNotifyReplayResponse {
  replayed: boolean;
  notifyId?: string;
  eventType?: string;
  songId?: string;
  reason?: string;
  error?: string;
  statusCode: number;
}

export async function buildFailedNotifyReplayResponse(
  input: unknown,
  notifyId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<FailedNotifyReplayResponse> {
  const payload = payloadRecord(input);
  const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
  const trimmedNotifyId = notifyId.trim();
  if (!trimmedNotifyId) {
    return { replayed: false, error: "invalid_notify_id", statusCode: 400 };
  }
  const entry = await latestFailedNotifyEntry(config.artist.workspaceRoot, trimmedNotifyId);
  if (!entry) {
    return { replayed: false, notifyId: trimmedNotifyId, error: "failed_notify_not_found", statusCode: 404 };
  }
  if (entry.status === "replayed") {
    return {
      replayed: false,
      notifyId: trimmedNotifyId,
      eventType: entry.eventType,
      songId: entry.songId,
      reason: "failed_notify_already_replayed",
      statusCode: 409
    };
  }
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return {
      replayed: false,
      notifyId: trimmedNotifyId,
      eventType: entry.eventType,
      songId: entry.songId,
      error: "telegram_token_missing",
      statusCode: 400
    };
  }
  try {
    await new TelegramNotifier({
      token,
      chatId: entry.chatId,
      workspaceRoot: config.artist.workspaceRoot,
      aiReviewProvider: config.aiReview.provider,
      dashboardBaseUrl: env.OPENCLAW_DASHBOARD_BASE_URL?.trim() || undefined
    }).notify(entry.eventPayload);
    await appendFailedNotifyReplayRecord(config.artist.workspaceRoot, entry, { ok: true });
    return {
      replayed: true,
      notifyId: trimmedNotifyId,
      eventType: entry.eventType,
      songId: entry.songId,
      reason: "failed_notify_replayed",
      statusCode: 200
    };
  } catch (error) {
    await appendFailedNotifyReplayRecord(config.artist.workspaceRoot, entry, { ok: false, error });
    return {
      replayed: false,
      notifyId: trimmedNotifyId,
      eventType: entry.eventType,
      songId: entry.songId,
      error: (error as Error)?.message ?? String(error),
      statusCode: 502
    };
  }
}

export interface CallbackActionsResponse {
  count: number;
  callbacks: Array<{
    callbackId: string;
    action: string;
    category: "producer_decision" | "working_confirmation";
    label: string;
    effect: string;
    songId?: string;
    songTitle?: string;
    stage?: string;
    proposalId?: string;
    platform?: string;
    createdAt: number;
    expiresAt: number;
    reminderSentAt?: number;
  }>;
}

export async function buildCallbackActionsResponse(input: unknown): Promise<CallbackActionsResponse> {
  const payload = payloadRecord(input);
  const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
  const routePath = "/plugins/artist-runtime/api/callback-actions";
  const status = queryValueFromPayload(payload, "status", routePath);
  const category = queryValueFromPayload(payload, "category", routePath);
  if (status && status !== "pending") {
    return { count: 0, callbacks: [] };
  }
  const summary = await listPendingCallbackActionSummaries(config.artist.workspaceRoot, {
    limit: integerFromPayloadOrQuery(payload, "limit", 20, routePath),
    category: category === "producer_decision" ? "producer_decision" : category === "working_confirmation" ? "working_confirmation" : undefined
  });
  const callbacks = await Promise.all(summary.recent.map(async (callback) => {
    const song = callback.songId ? await readSongState(config.artist.workspaceRoot, callback.songId).catch(() => undefined) : undefined;
    return {
      ...callback,
      songTitle: song?.title,
      stage: song ? stageFromSong(song) : undefined
    };
  }));
  return {
    count: summary.count,
    callbacks
  };
}

export interface SpawnProposalsResponse {
  count: number;
  proposals: Array<{
    proposalId: string;
    createdAt: string;
    status: string;
    title: string;
    voiceTop: string;
    coreTheme: string;
    observationSources: unknown[];
    motifRank?: number;
    cascadeTrace: unknown;
    actions: Array<{
      action: string;
      label: string;
      effect: string;
    }>;
  }>;
}

export async function buildSpawnProposalsResponse(input: unknown): Promise<SpawnProposalsResponse> {
  const payload = payloadRecord(input);
  const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
  const routePath = "/plugins/artist-runtime/api/spawn-proposals";
  const limit = integerFromPayloadOrQuery(payload, "limit", 20, routePath);
  const proposals = await listPendingSpawnProposals(config.artist.workspaceRoot);
  const actions = ["song_spawn_inject", "song_spawn_skip", "song_spawn_edit"].map(describeCallbackActionEffect);
  return {
    count: proposals.length,
    proposals: proposals.slice(0, Math.max(0, limit)).map((proposal) => ({
      proposalId: proposal.proposalId,
      createdAt: proposal.createdAt,
      status: proposal.status,
      title: proposal.title,
      voiceTop: proposal.voiceTop,
      coreTheme: proposal.coreTheme,
      observationSources: proposal.observationSources,
      motifRank: proposal.motifRank,
      cascadeTrace: proposal.cascadeTrace,
      actions
    }))
  };
}

export interface SafeTickTriggerResponse {
  triggered: boolean;
  tickerOutcome?: string;
  stage?: string;
  songId?: string;
  reason: string;
  statusCode: number;
}

function safeTickTokenFromPayload(payload: Record<string, unknown>): string | undefined {
  const direct = typeof payload.token === "string"
    ? payload.token
    : typeof payload.authToken === "string"
      ? payload.authToken
      : typeof payload.safeTickToken === "string"
        ? payload.safeTickToken
        : undefined;
  if (direct?.trim()) {
    return direct.trim();
  }
  const authorization = typeof payload.authorization === "string" ? payload.authorization.trim() : "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
}

export async function buildSafeTickTriggerResponse(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env
): Promise<SafeTickTriggerResponse> {
  const payload = payloadRecord(input);
  const expectedToken = env.OPENCLAW_SAFE_TICK_TRIGGER_TOKEN?.trim() || env.OPENCLAW_TICKER_WATCHER_TOKEN?.trim();
  if (!expectedToken) {
    return { triggered: false, reason: "safe_tick_trigger_token_missing", statusCode: 403 };
  }
  if (safeTickTokenFromPayload(payload) !== expectedToken) {
    return { triggered: false, reason: "safe_tick_trigger_unauthorized", statusCode: 401 };
  }
  const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
  const result = await getAutopilotTicker().runNow(config);
  emitRuntimeEvent({
    type: "autopilot_ticker_safe_recovery",
    outcome: result.outcome,
    songId: result.state.currentSongId,
    timestamp: Date.now()
  });
  return {
    triggered: true,
    tickerOutcome: result.outcome,
    stage: result.state.stage,
    songId: result.state.currentSongId,
    reason: "autopilot_ticker_safe_recovery",
    statusCode: 200
  };
}

export async function buildStatusExportResponse(
  config?: Partial<ArtistRuntimeConfig>,
  window: ObservabilityExportWindow = "7d",
  now = new Date()
): Promise<StatusExportResponse> {
  const mergedConfig = await resolveRuntimeConfig(config);
  const includeArchive = window === "all";
  const [status, events, platformStats] = await Promise.all([
    buildStatusResponse(mergedConfig),
    readDistributionEvents(mergedConfig.artist.workspaceRoot, Number.MAX_SAFE_INTEGER, { includeArchive }),
    buildPlatformStats(mergedConfig.artist.workspaceRoot, now, { includeArchive })
  ]);

  return {
    window,
    exportedAt: now.toISOString(),
    status,
    ledger: {
      events: filterEventsByExportWindow(events, window, now),
      platformStats
    }
  };
}

export function registerRoutes(api: unknown): void {
  registerRuntimeEventStreamRoute(api);

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime",
    contentType: "text/html; charset=utf-8",
    handler: async () => producerConsoleHtml()
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/status",
    handler: async (input) => buildStatusResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: "GET",
    match: "prefix",
    path: "/plugins/artist-runtime/api/callback-actions",
    handler: buildCallbackActionsResponse
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/spawn-proposals",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      if (method !== "POST") {
        return buildSpawnProposalsResponse(input);
      }
      // Plan v10.65 Layer 2: receive-independent spawn GO from the Console.
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/spawn-proposals");
      const proposalId = segments[0] ?? (typeof payload.proposalId === "string" ? payload.proposalId : "");
      const decision = segments[1];
      const action = decision === "inject"
        ? "song_spawn_inject"
        : decision === "skip"
          ? "song_spawn_skip"
          : undefined;
      if (!proposalId || !action) {
        return { error: "unknown_spawn_proposal_decision", statusCode: 400 };
      }
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      return buildProducerCallbackDispatchResponse(config.artist.workspaceRoot, { action, proposalId });
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/autopilot/safe-tick-trigger",
    handler: buildSafeTickTriggerResponse
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/status/export",
    handler: async (input) => {
      const payload = payloadRecord(input);
      return buildStatusExportResponse(
        payload.config as Partial<ArtistRuntimeConfig> | undefined,
        exportWindowFromPayload(payload)
      );
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/telegram/callback-dispatch",
    handler: buildInternalCallbackDispatchResponse
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/notify",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/notify");
      if (method === "GET" && segments.length === 1 && segments[0] === "failed") {
        return buildFailedNotifyListResponse(input);
      }
      if (method === "POST" && segments.length === 2 && segments[0] === "replay") {
        return buildFailedNotifyReplayResponse(input, segments[1] ?? "");
      }
      return {
        error: "unknown_notify_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/notify"),
        statusCode: 404
      };
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/config",
    handler: async (input) => buildConfigResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    path: "/plugins/artist-runtime/api/config/overrides",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const context = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const responseConfig = { artist: { workspaceRoot: context.artist.workspaceRoot } } as Partial<ArtistRuntimeConfig>;
      if (method === "GET") {
        return buildConfigOverridesResponse(responseConfig);
      }
      const { patch, errors } = runtimeSafetyPatchFromPayload(payload);
      if (errors.length > 0 || !patch) {
        return {
          error: "invalid_config_overrides",
          statusCode: 400,
          errors
        };
      }
      const before = await buildConfigOverridesResponse(responseConfig);
      await writeRuntimeSafetyOverrides(context.artist.workspaceRoot, patch);
      const after = await buildConfigOverridesResponse(responseConfig);
      await appendConfigOverridesAudit(context.artist.workspaceRoot, before, after);
      return after;
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/artist-mind",
    handler: async (input) => buildArtistMindResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    path: "/plugins/artist-runtime/api/songbook/lookup",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const options = { fetchImpl: fetch };
      return payloadRequestMethod(payload) === "POST"
        ? syncSongbookFromITunes(config.artist.workspaceRoot, options)
        : buildSongbookLookup(config.artist.workspaceRoot, options);
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/audit",
    handler: async (input) => buildAuditLogResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/recovery",
    handler: async (input) => buildRecoveryResponse(payloadRecord(input).config as Partial<ArtistRuntimeConfig> | undefined)
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/proposals",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/proposals");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const workspaceRoot = config.artist.workspaceRoot;

      try {
        if (method === "GET" && segments.length === 0) {
          return {
            proposals: await listPendingProposalDetails(workspaceRoot)
          };
        }

        if (method === "POST" && segments.length === 2) {
          const proposalId = segments[0] ?? "";
          const action = segments[1];
          if (action === "yes") {
            return await handleProposalResponse(workspaceRoot, {
              proposalId,
              action: "yes",
              actor: { kind: "ui_api" }
            });
          }
          if (action === "no") {
            return await handleProposalResponse(workspaceRoot, {
              proposalId,
              action: "no",
              actor: { kind: "ui_api" }
            });
          }
          if (action === "edit") {
            const fields = proposalFieldsFromPayload(payload);
            return await handleProposalResponse(workspaceRoot, {
              proposalId,
              action: "edit",
              actor: { kind: "ui_api" },
              fieldUpdates: fields
            });
          }
        }
      } catch (error) {
        return proposalRouteError(error);
      }

      return {
        error: "unknown_proposals_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/proposals")
      };
    }
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/songs",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/songs");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);

      if (method === "GET") {
        if (segments.length === 0) {
          return buildSongsResponse(config);
        }
        if (segments.length === 1) {
          return buildSongDetailResponse(segments[0] ?? "song-001", config);
        }
        if (segments.length === 2 && segments[1] === "ledger") {
          return buildSongLedgerResponse(segments[0] ?? "song-001", config);
        }
        if (segments.length === 2 && segments[1] === "events") {
          const limit = typeof payload.limit === "number" ? payload.limit : Number.parseInt(String(payload.limit ?? "200"), 10);
          return buildSongEventsResponse(segments[0] ?? "song-001", config, limit);
        }
      }

      if (method === "POST") {
        if (segments.length === 1 && segments[0] === "ideate") {
          return createSongIdea({
            workspaceRoot: config.artist.workspaceRoot,
            title: typeof payload.title === "string" ? payload.title : undefined,
            artistReason: typeof payload.artistReason === "string" ? payload.artistReason : undefined,
            config
          });
        }
        if (segments.length === 2 && segments[1] === "select-take") {
          return selectTake({
            workspaceRoot: config.artist.workspaceRoot,
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            runId: typeof payload.runId === "string" ? payload.runId : undefined,
            selectedTakeId: typeof payload.selectedTakeId === "string" ? payload.selectedTakeId : undefined,
            reason: typeof payload.reason === "string" ? payload.reason : undefined
          });
        }
        if (segments.length === 2 && segments[1] === "notify-review") {
          return buildNotifyReviewResponse(input, segments[0] ?? "song-001");
        }
        if (segments.length === 2 && (segments[1] === "songbook-write" || segments[1] === "songbook-skip" || segments[1] === "archive" || segments[1] === "discard")) {
          if (payloadContainsSecretLikeText(payload, ["reason", "note"])) {
            return {
              error: "secret_like_payload_rejected",
              statusCode: 400
            };
          }
          const action = segments[1] === "songbook-write"
            ? "song_songbook_write"
            : segments[1] === "songbook-skip"
              ? "song_skip"
              : segments[1] === "archive"
                ? "song_archive"
                : "song_discard";
          return handleSongPublishActionRequest({
            root: config.artist.workspaceRoot,
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            action,
            actor: { kind: "ui_api" }
          });
        }
        if (segments.length === 2 && segments[1] === "social-assets") {
          return prepareSocialAssets({
            workspaceRoot: config.artist.workspaceRoot,
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            config
          });
        }
        if (segments.length === 2 && segments[1] === "prompt-pack-go") {
          // Plan v10.65 Layer 2: receive-independent Suno pre-GO from the Console.
          return buildProducerCallbackDispatchResponse(config.artist.workspaceRoot, {
            action: "prompt_pack_go",
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001")
          });
        }
      }

      return {
        error: "unknown_songs_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/songs")
      };
    }
  });

  safeRegisterRoute(api, {
    method: "GET",
    path: "/plugins/artist-runtime/api/prompt-ledger",
    handler: async (input) => {
      const payload = payloadRecord(input);
      return buildPromptLedgerResponse(
        typeof payload.songId === "string" ? payload.songId : undefined,
        payload.config as Partial<ArtistRuntimeConfig> | undefined
      );
    }
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/alerts",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/alerts");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);

      if (method === "GET" && segments.length === 0) {
        return buildAlertsResponse(config);
      }
      if (method === "POST" && segments.length === 2 && segments[1] === "ack") {
        return acknowledgeAlert(config.artist.workspaceRoot, segments[0] ?? "unknown");
      }

      return {
        error: "unknown_alerts_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/alerts")
      };
    }
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/platforms",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/platforms");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);

      if (method === "GET") {
        if (segments.length === 0) {
          return buildPlatformsResponse(config);
        }
        const platform = platformFromSegment(segments[0]);
        if (segments.length === 1 && platform) {
          return buildPlatformDetailResponse(platform, config);
        }
      }

      if (method === "POST") {
        if (segments.length === 2 && segments[0] === "x" && segments[1] === "simulate-reply") {
          const dryRunConfig = mergeResolvedConfig(config, {
            autopilot: {
              dryRun: true
            } as ArtistRuntimeConfig["autopilot"]
          } as Partial<ArtistRuntimeConfig>);
          const songId = typeof payload.songId === "string"
            ? payload.songId
            : (await listSongStates(dryRunConfig.artist.workspaceRoot))[0]?.songId;
          if (!songId) {
            return {
              result: {
                accepted: false,
                platform: "x" as const,
                dryRun: true,
                reason: "no_song_selected_for_reply_simulation"
              },
              entry: undefined
            };
          }
          return publishSocialAction({
            workspaceRoot: dryRunConfig.artist.workspaceRoot,
            songId,
            platform: "x",
            action: "reply",
            postType: "reply",
            text: typeof payload.text === "string" ? payload.text : undefined,
            targetId: typeof payload.targetId === "string" ? payload.targetId : undefined,
            targetUrl: typeof payload.targetUrl === "string" ? payload.targetUrl : undefined,
            config: dryRunConfig
          });
        }

        const platform = platformFromSegment(segments[0]);
        if (segments.length === 2 && platform && segments[1] === "test") {
          const status = await buildPlatformDetailResponse(platform, config);
          const testedAtMs = Date.now();
          if (platform === "tiktok") {
            await patchResolvedConfig(config.artist.workspaceRoot, {
              distribution: {
                platforms: {
                  tiktok: {
                    authStatus: "unconfigured",
                    liveGoArmed: false
                  }
                }
              } as unknown as ArtistRuntimeConfig["distribution"]
            } as Partial<ArtistRuntimeConfig>);
            status.authStatus = "unconfigured";
            status.lastTestedAt = undefined;
          } else {
            const authStatus = status.connected ? "tested" : "failed";
            const instagramTokenExpiresAt = status.connected
              ? config.distribution.platforms.instagram.accessTokenExpiresAt ?? testedAtMs + INSTAGRAM_DEFAULT_TOKEN_EXPIRY_MS
              : undefined;
            const platformPatch = platform === "instagram"
              ? {
                  instagram: {
                    authStatus,
                    lastTestedAt: testedAtMs,
                    ...(instagramTokenExpiresAt !== undefined ? { accessTokenExpiresAt: instagramTokenExpiresAt } : {})
                  }
                }
              : {
                  x: {
                    authStatus,
                    lastTestedAt: testedAtMs
                  }
                };
            await patchResolvedConfig(config.artist.workspaceRoot, {
              distribution: {
                platforms: platformPatch
              } as unknown as ArtistRuntimeConfig["distribution"]
            } as Partial<ArtistRuntimeConfig>);
            status.authStatus = authStatus;
            status.lastTestedAt = testedAtMs;
            if (platform === "instagram" && status.connected) {
              status.instagramTokenExpiringSoon = isInstagramTokenExpiringSoon(
                config.distribution.platforms.instagram.accessTokenExpiresAt ?? testedAtMs + INSTAGRAM_DEFAULT_TOKEN_EXPIRY_MS,
                testedAtMs
              );
            }
          }
          return {
            platform,
            status,
            testedAt: new Date(testedAtMs).toISOString()
          };
        }
        if (segments.length === 2 && platform && (segments[1] === "connect" || segments[1] === "disconnect")) {
          const nextConfig = await patchResolvedConfig(config.artist.workspaceRoot, {
            distribution: {
              platforms: {
                [platform]: { enabled: segments[1] === "connect" }
              }
            } as unknown as ArtistRuntimeConfig["distribution"]
          } as Partial<ArtistRuntimeConfig>);
          return buildPlatformDetailResponse(platform, nextConfig);
        }
      }

      return {
        error: "unknown_platforms_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/platforms")
      };
    }
  });

  safeRegisterRoute(api, {
    method: ["GET", "POST"],
    match: "prefix",
    path: "/plugins/artist-runtime/api/suno",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const method = payloadRequestMethod(payload);
      const segments = payloadPathSegments(payload, "/plugins/artist-runtime/api/suno");
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);

      if (method === "GET") {
        if (segments.length === 1 && segments[0] === "status") {
          return buildSunoStatusResponse(config);
        }
        if (segments.length === 1 && segments[0] === "runs") {
          const songId = typeof payload.songId === "string"
            ? payload.songId
            : (await listSongStates(config.artist.workspaceRoot))[0]?.songId;
          return songId ? readAllSunoRuns(config.artist.workspaceRoot, songId) : [];
        }
        if (segments.length === 1 && segments[0] === "artifacts") {
          return buildSunoArtifactsPage(config.artist.workspaceRoot, payload.offset, payload.limit);
        }
        if (segments.length === 2 && segments[0] === "diagnostics" && segments[1] === "export") {
          return buildSunoDiagnosticsExportResponse(config, sunoDiagnosticsDaysFromPayload(payload));
        }
      }

      if (method === "POST") {
        if (segments.length === 2 && segments[0] === "budget" && segments[1] === "reset") {
          return new SunoBudgetTracker(config.artist.workspaceRoot).reset(
            config.music.suno.dailyCreditLimit,
            config.music.suno.monthlyCreditLimit
          );
        }
        if (segments.length === 1 && segments[0] === "connect") {
          return new SunoBrowserWorker(config.artist.workspaceRoot, { config }).connect();
        }
        if (segments.length === 1 && segments[0] === "reconnect") {
          return new SunoBrowserWorker(config.artist.workspaceRoot, { config }).reconnect();
        }
        if (segments.length === 2 && segments[0] === "handoff" && segments[1] === "complete") {
          // Plan v10.33 Phase 4.5: 御大が `scripts/openclaw-suno-login.mjs` で artist 専用
          // user data dir に sign in した後、 worker state を "connected" に確定するための
          // 手動 signal endpoint。 driver.probe() は発火しない (御大の手動操作で sign in
          // 完了が保証される)。
          return new SunoBrowserWorker(config.artist.workspaceRoot, { config }).completeManualLoginHandoff();
        }
        if (segments.length === 2 && segments[0] === "generate") {
          return generateSunoRun({
            workspaceRoot: config.artist.workspaceRoot,
            songId: segments[1] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            config
          });
        }
      }

      return {
        error: "unknown_suno_route",
        method,
        requestPath: payloadRequestPath(payload, "/plugins/artist-runtime/api/suno")
      };
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/config/update",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const context = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const patchRaw = (payload.patch ?? payload.config) as Partial<ArtistRuntimeConfig> | undefined;
      return patchResolvedConfig(context.artist.workspaceRoot, (patchRaw ?? {}) as Partial<ArtistRuntimeConfig>);
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/pause",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      return pauseAutopilot(config.artist.workspaceRoot, typeof payload.reason === "string" ? payload.reason : undefined);
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/resume",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      if (payload.resetState === true) {
        return new AutopilotControlService().resume(config.artist.workspaceRoot, {
          resetState: true,
          reason: typeof payload.reason === "string" ? payload.reason : undefined,
          source: "operator"
        });
      }
      return resumeAutopilot(config.artist.workspaceRoot);
    }
  });

  safeRegisterRoute(api, {
    method: "POST",
    path: "/plugins/artist-runtime/api/run-cycle",
    handler: async (input) => {
      const payload = payloadRecord(input);
      const config = await resolveRuntimeConfig(payload.config as Partial<ArtistRuntimeConfig> | undefined);
      const manualSeedPayload = payload.manualSeed as { hint?: unknown } | undefined;
      const manualSeed = typeof manualSeedPayload?.hint === "string"
        ? { hint: manualSeedPayload.hint.trim() }
        : undefined;
      const result = await getAutopilotTicker().runNow(config, manualSeed);
      return {
        ...result.state,
        tickerOutcome: result.outcome,
        tickerLastTickAt: getLastTickAt()
      };
    }
  });

}
