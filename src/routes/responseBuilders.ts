import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InstagramConnector } from "../connectors/social/instagramConnector.js";
import { TikTokConnector } from "../connectors/social/tiktokConnector.js";
import { XBirdConnector } from "../connectors/social/xBirdConnector.js";
import { BrowserWorkerSunoConnector } from "../connectors/suno/browserWorkerConnector.js";
import { startRuntimeEventLedgerFromEnv, startTelegramNotifierFromEnv } from "../services/index.js";
import { collectAlerts } from "../services/alerts.js";
import { appendAuditLog, createAuditEvent } from "../services/auditLog.js";
import { listSongStates, readArtistMind, readSongState, updateSongState } from "../services/artistState.js";
import { ArtistAutopilotService, PRODUCER_REVIEW_PAUSED_REASON, PRODUCER_REVIEW_SUSPENDED_AT, readAutopilotRunState, stageFromSong, writeAutopilotRunState } from "../services/autopilotService.js";
import { getAutopilotTicker, getAutopilotTickerIntervalMs, getLastOutcome, getLastTickAt } from "../services/autopilotTicker.js";
import { readBirdLedgerDetail, readBirdRateLimitStatus } from "../services/birdRateLimiter.js";
import { appendCallbackAuditEvent, describeCallbackActionEffect, listPendingCallbackActionSummaries, readCallbackActionEntries, resolveCallbackAction, summarizePendingCallbackActions, type CallbackActionEntry } from "../services/callbackActionRegistry.js";
import { buildCascadeTrace } from "../services/cascadeTrace.js";
import { listPendingProposals } from "../services/conversationalSession.js";
import { composeDraftBoxNextAction } from "../services/draftBoxNextAction.js";
import { readReceiveHealth } from "../services/receiveHealthService.js";
import { buildPlatformStats, readDistributionEvents } from "../services/distributionLedgerReader.js";
import { emitRuntimeEvent, getRuntimeEventBus } from "../services/runtimeEventBus.js";
import { readRuntimeEvents, readSongEventsAsc } from "../services/runtimeEventsLedger.js";
import { appendFailedNotifyReplayRecord, latestFailedNotifyEntry, listUnreplayedFailedNotifications, summarizeFailedNotifications } from "../services/failedNotifyLedger.js";
import { getSongPromptLedgerPath } from "../services/promptLedger.js";
import { getBirdDailyMaxOverride, getBirdMinIntervalMinutesOverride, getDashboardBaseUrl, getNewsRssUrls, isDebugCallbackDispatchEnabled, isDebugNotifyReviewEnabled, isNewsArticleResolverEnabled, isNewsBrowserResolverEnabled, isSunoLiveDisabled, isSunoLiveEnabled, isTelegramNotifierEnabled, isXTcoFetchEnabled, readConfigOverrides, resolveRuntimeConfig, type RuntimeSafetyOverridesPatch } from "../services/runtimeConfig.js";
import { readLatestSocialAction } from "../services/socialPublishing.js";
import { SocialDistributionWorker } from "../services/socialDistributionWorker.js";
import { listPendingSpawnProposals } from "../services/spawnProposalQueue.js";
import { buildEffectiveDryRunMap, resolvePlatformSocialDryRun } from "../services/socialDryRunResolver.js";
import { readDistributionDetectionState } from "../services/songDistributionPoller.js";
import { secretLikePattern } from "../services/personaMigrator.js";
import { cleanupCanonicalPersonaSources } from "../services/personaCanonicalCleanup.js";
import { auditPersonaCompleteness } from "../services/personaFieldAuditor.js";
import { writeDerivedIdentityProjection } from "../services/personaIdentityProjection.js";
import { readProducerPersonaSummary, writeProducerPersona } from "../services/producerFileBuilder.js";
import { proposePersonaFields } from "../services/personaProposer.js";
import { personaCanonicalLegacyFields } from "../services/personaCanonical.js";
import { readArtistPersonaSummary, writeArtistPersona, writePersonaCompletionMarker } from "../services/personaFileBuilder.js";
import { describePersonaSetupReasons, readPersonaSetupStatus } from "../services/personaSetupDetector.js";
import { readSoulPersonaSummary, writeSoulPersona } from "../services/soulFileBuilder.js";
import { readSnapshotPersonaFile, snapshotPersonaFilenames, writeSnapshotPersonaFile, type SnapshotPersonaLayer } from "../services/snapshotPersonaFileBuilder.js";
import { STATUS_SUNO_ARTIFACT_LIMIT } from "../services/sunoArtifacts.js";
import { SunoBudgetTracker } from "../services/sunoBudget.js";
import { readLatestPromptPackMetadata } from "../services/sunoPromptPackFiles.js";
import { buildSunoArtifactIndex, readAllSunoRuns, readLatestSunoRun } from "../services/sunoRuns.js";
import { workerImportOutcomeFromSong } from "../services/sunoBrowserWorker.js";
import { readTakeHistory } from "../services/takeSelection.js";
import { routeTelegramCallback } from "../services/telegramCallbackHandler.js";
import { getTelegramOwnerUserIds } from "../services/telegramAuth.js";
import type { TelegramClient } from "../services/telegramClient.js";
import { TelegramNotifier } from "../services/telegramNotifier.js";
import { readXObservationDiagnostics } from "../services/xObservationDiagnostics.js";
import { integerFromPayloadOrQuery, isLocalRoutePayload, optionalInteger, payloadInteger, payloadRecord, queryValueFromPayload } from "./payloadHelpers.js";
import { serializeRuntimeEventForSse } from "./runtimeEventStream.js";
import type {
  ArtistRuntimeConfig,
  AiReviewProvider,
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
  SunoDiagnosticsImportOutcome,
  PersonaAnswers,
  PersonaField
} from "../types.js";

function logRouteFallback(reason: string, path: string, error?: unknown): void {
  const detail = error instanceof Error ? ` (${error.name})` : "";
  console.warn(`[artist-runtime] route fallback ${reason}: ${path}${detail}`);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
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
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      console.debug(`[artist-runtime] route fallback jsonl_read_fallback: ${path}`);
    }
    return [];
  }
  if (!contents) {
    return [];
  }
  try {
    return contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    logRouteFallback("jsonl_parse_fallback", path, error);
    return [];
  }
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
export const INSTAGRAM_DEFAULT_TOKEN_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000;

export function isInstagramTokenExpiringSoon(expiresAt: number | undefined, now = Date.now()): boolean {
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

async function buildAwaitingSunoTakeUrlReady(workspaceRoot: string): Promise<NonNullable<StatusResponse["awaitingSunoTakeUrlReady"]>> {
  const recent = (await listSongStates(workspaceRoot))
    .filter((song) => song.status === "suno_take_url_ready")
    .map((song) => ({
      songId: song.songId,
      title: song.title,
      selectedTakeId: song.selectedTakeId,
      urls: song.publicLinks,
      updatedAt: song.updatedAt
    }));
  return {
    count: recent.length,
    recent: recent.slice(0, 5)
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
  const [artistFilesReady, personaSetupStatus] = await Promise.all([
    fileHasContent(join(workspaceRoot, "ARTIST.md")),
    fileHasContent(join(workspaceRoot, "SOUL.md")),
    fileHasContent(join(workspaceRoot, "artist", "SOCIAL_VOICE.md")),
    fileHasContent(join(workspaceRoot, "artist", "RELEASE_POLICY.md"))
  ]).then((values) => values.every(Boolean)).then(async (filesReady) => [filesReady, await readPersonaSetupStatus(workspaceRoot)] as const);
  const artistProfileReady = artistFilesReady && !personaSetupStatus.needsSetup;
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
        : personaSetupStatus.needsSetup
          ? `Send /setup in Telegram (or edit ARTIST.md): ${describePersonaSetupReasons(personaSetupStatus.reasons)}.`
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

export function proposalFieldsFromPayload(payload: Record<string, unknown>): Record<string, string> {
  const rawFields = typeof payload.fields === "object" && payload.fields !== null
    ? payload.fields as Record<string, unknown>
    : {};
  return Object.fromEntries(
    Object.entries(rawFields)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([field, value]) => [field, value])
  );
}

export function payloadContainsSecretLikeText(payload: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const value = payload[key];
    return typeof value === "string" && secretLikePattern.test(value);
  });
}

export interface PersonaRouteResponse {
  artist: Awaited<ReturnType<typeof readArtistPersonaSummary>>;
  soul: Awaited<ReturnType<typeof readSoulPersonaSummary>>;
  identity: { text: string; readOnly: true; source: "derived" };
  producer: { text: string };
  inner: { text: string; readOnly: true; source: "internal" };
  setup: Awaited<ReturnType<typeof readPersonaSetupStatus>> & { reasonsText: string };
  audit: Awaited<ReturnType<typeof auditPersonaCompleteness>>;
  aiDraftSupported: ["artist", "soul", "producer"];
  provider: AiReviewProvider;
}

const personaFieldWhitelist = new Set<PersonaField>(personaCanonicalLegacyFields({ aiProposableOnly: true }) as PersonaField[]);

const snapshotPersonaLayers = new Set<SnapshotPersonaLayer>(["identity", "producer", "inner"]);

function userFacingPersonaAudit(audit: Awaited<ReturnType<typeof auditPersonaCompleteness>>): Awaited<ReturnType<typeof auditPersonaCompleteness>> {
  return {
    ...audit,
    issues: []
  };
}

function recordFromPayload(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = payload[key];
  return typeof nested === "object" && nested !== null && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : payload;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function artistPersonaFromPayload(payload: Record<string, unknown>): Partial<PersonaAnswers> {
  const record = recordFromPayload(payload, "artist");
  return {
    identityLine: stringField(record, "identityLine"),
    soundDna: stringField(record, "soundDna"),
    obsessions: stringField(record, "obsessions"),
    lyricsRules: stringField(record, "lyricsRules"),
    socialVoice: stringField(record, "socialVoice")
  };
}

function soulPersonaFromPayload(payload: Record<string, unknown>): Partial<PersonaAnswers> {
  const record = recordFromPayload(payload, "soul");
  return {
    conversationTone: stringField(record, "conversationTone"),
    refusalStyle: stringField(record, "refusalStyle")
  };
}

function snapshotTextFromPayload(payload: Record<string, unknown>, layer: SnapshotPersonaLayer): string {
  const record = recordFromPayload(payload, layer);
  const text = stringField(record, "text");
  return text ?? "";
}

function personaRouteError(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "identity_projection_read_only") {
    return { error: "identity_projection_read_only", statusCode: 400 };
  }
  if (message === "inner_projection_read_only") {
    return { error: "inner_projection_read_only", statusCode: 400 };
  }
  if (message === "persona_block_contains_secret_like_text") {
    return { error: "persona_block_contains_secret_like_text", statusCode: 400 };
  }
  if (message === "snapshot_persona_too_long") {
    return { error: "snapshot_persona_too_long", statusCode: 400 };
  }
  return { error: "persona_route_failed", message, statusCode: 500 };
}

export async function buildPersonaResponse(config?: Partial<ArtistRuntimeConfig>): Promise<PersonaRouteResponse> {
  const mergedConfig = await resolveRuntimeConfig(config);
  const root = mergedConfig.artist.workspaceRoot;
  await cleanupCanonicalPersonaSources(root);
  const [artist, soul, producer, inner, setupStatus, audit] = await Promise.all([
    readArtistPersonaSummary(root),
    readSoulPersonaSummary(root),
    readProducerPersonaSummary(root),
    readSnapshotPersonaFile(root, snapshotPersonaFilenames.inner),
    readPersonaSetupStatus(root),
    auditPersonaCompleteness(root)
  ]);
  const responseArtist = {
    ...artist,
    artistName: mergedConfig.artist.identity.displayName?.trim() || artist.artistName
  };
  const identityProjection = await writeDerivedIdentityProjection(root, mergedConfig, "persona_response_projection_sync");
  return {
    artist: responseArtist,
    soul,
    identity: { text: identityProjection.text, readOnly: true, source: "derived" },
    producer: { text: producer.producerFacts },
    inner: { text: inner, readOnly: true, source: "internal" },
    setup: { ...setupStatus, reasonsText: describePersonaSetupReasons(setupStatus.reasons) },
    audit: userFacingPersonaAudit(audit),
    aiDraftSupported: ["artist", "soul", "producer"],
    provider: mergedConfig.aiReview.provider
  };
}

export async function buildPersonaWriteResponse(
  config: Partial<ArtistRuntimeConfig> | undefined,
  layer: "artist" | "soul" | SnapshotPersonaLayer,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const mergedConfig = await resolveRuntimeConfig(config);
    const root = mergedConfig.artist.workspaceRoot;
    if (layer === "identity") {
      throw new Error("identity_projection_read_only");
    }
    if (layer === "inner") {
      throw new Error("inner_projection_read_only");
    }
    const result = layer === "artist"
      ? await writeArtistPersona(root, artistPersonaFromPayload(payload))
      : layer === "soul"
        ? await writeSoulPersona(root, soulPersonaFromPayload(payload))
        : layer === "producer"
          ? await writeProducerPersona(root, { producerFacts: snapshotTextFromPayload(payload, layer) })
          : await writeSnapshotPersonaFile(root, snapshotPersonaFilenames[layer], snapshotTextFromPayload(payload, layer));
    return { ok: true, layer, result, persona: await buildPersonaResponse(mergedConfig) };
  } catch (error) {
    return personaRouteError(error);
  }
}

export async function buildPersonaProposeResponse(
  config: Partial<ArtistRuntimeConfig> | undefined,
  payload: Record<string, unknown>
): Promise<unknown> {
  const mode = typeof payload.mode === "string" ? payload.mode : "fill_missing";
  const rawFields = Array.isArray(payload.fields) ? payload.fields : [];
  const defaultFields = mode === "review_all" || mode === "dedupe"
    ? [...personaFieldWhitelist]
    : [];
  const requestedFields = rawFields.length > 0 ? rawFields : defaultFields;
  if (
    requestedFields.length === 0 ||
    !["fill_missing", "review_all", "dedupe"].includes(mode) ||
    requestedFields.some((field) => typeof field !== "string" || !personaFieldWhitelist.has(field as PersonaField))
  ) {
    return { error: "invalid_persona_fields", statusCode: 400 };
  }
  const fields = requestedFields as PersonaField[];
  const mergedConfig = await resolveRuntimeConfig(config);
  const root = mergedConfig.artist.workspaceRoot;
  const [artistMd, soulMd, producerMd] = await Promise.all([
    readFile(join(root, "ARTIST.md"), "utf8").catch(() => ""),
    readFile(join(root, "SOUL.md"), "utf8").catch(() => ""),
    readFile(join(root, "PRODUCER.md"), "utf8").catch(() => "")
  ]);
  return proposePersonaFields(
    { fields, mode: mode as "fill_missing" | "review_all" | "dedupe", source: { artistMd, soulMd, producerMd } },
    { aiReviewProvider: mergedConfig.aiReview.provider }
  );
}

export async function buildPersonaCompleteResponse(config?: Partial<ArtistRuntimeConfig>): Promise<Record<string, unknown>> {
  const mergedConfig = await resolveRuntimeConfig(config);
  const path = await writePersonaCompletionMarker(mergedConfig.artist.workspaceRoot, new Date(), "web");
  const setup = (await buildPersonaResponse(mergedConfig)).setup;
  return { ok: true, path, setup };
}

export function isPersonaSnapshotLayer(value: string | undefined): value is SnapshotPersonaLayer {
  return Boolean(value && snapshotPersonaLayers.has(value as SnapshotPersonaLayer));
}

export function proposalRouteError(error: unknown): Record<string, unknown> {
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

type ConfigFieldSource = "config" | "env";

interface ConfigFieldMeta {
  source: ConfigFieldSource;
  editable: boolean;
  envVar?: string;
}

type ConfigFieldMetaMap = Record<string, ConfigFieldMeta>;

type RuntimeDiagnosticSource = "env" | "default";

interface RuntimeDiagnosticFlag {
  envVar: string;
  source: RuntimeDiagnosticSource;
  editable: false;
  enabled: boolean;
}

interface RuntimeDiagnosticConfigured {
  envVar: string;
  source: RuntimeDiagnosticSource;
  editable: false;
  configured: boolean;
}

interface RuntimeDiagnosticCount {
  envVar: string;
  source: RuntimeDiagnosticSource;
  editable: false;
  configured: boolean;
  count: number;
}

interface RuntimeDiagnostics {
  newsX: {
    rssUrls: RuntimeDiagnosticCount;
    browserResolve: RuntimeDiagnosticFlag;
    articleResolve: RuntimeDiagnosticFlag;
    firefoxProfile: RuntimeDiagnosticConfigured;
    tcoFetch: RuntimeDiagnosticFlag;
  };
  telegram: {
    active: boolean;
    reason: "ready" | "disabled_by_flag" | "missing_token" | "missing_owner_user_ids";
    botToken: RuntimeDiagnosticConfigured;
    ownerUserIds: RuntimeDiagnosticCount;
    notifier: RuntimeDiagnosticFlag;
  };
}

function configField(source: ConfigFieldSource = "config", envVar?: string, editable = source !== "env"): ConfigFieldMeta {
  return {
    source,
    editable,
    ...(envVar ? { envVar } : {})
  };
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function diagnosticSource(env: NodeJS.ProcessEnv, key: string): RuntimeDiagnosticSource {
  return envValue(env, key) ? "env" : "default";
}

function buildRuntimeDiagnostics(env: NodeJS.ProcessEnv = process.env): RuntimeDiagnostics {
  const newsRssUrls = getNewsRssUrls(env);
  const ownerUserIds = getTelegramOwnerUserIds(env);
  const tokenConfigured = Boolean(envValue(env, "TELEGRAM_BOT_TOKEN"));
  const ownerUserIdsConfigured = ownerUserIds.size > 0;
  const notifierEnabled = isTelegramNotifierEnabled(env);
  let telegramReason: RuntimeDiagnostics["telegram"]["reason"] = "ready";
  if (!notifierEnabled) {
    telegramReason = "disabled_by_flag";
  } else if (!tokenConfigured) {
    telegramReason = "missing_token";
  } else if (!ownerUserIdsConfigured) {
    telegramReason = "missing_owner_user_ids";
  }

  return {
    newsX: {
      rssUrls: {
        envVar: "OPENCLAW_NEWS_RSS_URLS",
        source: diagnosticSource(env, "OPENCLAW_NEWS_RSS_URLS"),
        editable: false,
        configured: newsRssUrls.length > 0,
        count: newsRssUrls.length
      },
      browserResolve: {
        envVar: "OPENCLAW_NEWS_BROWSER_RESOLVE",
        source: diagnosticSource(env, "OPENCLAW_NEWS_BROWSER_RESOLVE"),
        editable: false,
        enabled: isNewsBrowserResolverEnabled(env)
      },
      articleResolve: {
        envVar: "OPENCLAW_NEWS_ARTICLE_RESOLVE",
        source: diagnosticSource(env, "OPENCLAW_NEWS_ARTICLE_RESOLVE"),
        editable: false,
        enabled: isNewsArticleResolverEnabled(env)
      },
      firefoxProfile: {
        envVar: "OPENCLAW_X_FIREFOX_PROFILE",
        source: diagnosticSource(env, "OPENCLAW_X_FIREFOX_PROFILE"),
        editable: false,
        configured: Boolean(envValue(env, "OPENCLAW_X_FIREFOX_PROFILE"))
      },
      tcoFetch: {
        envVar: "OPENCLAW_X_TCO_FETCH_ENABLED",
        source: diagnosticSource(env, "OPENCLAW_X_TCO_FETCH_ENABLED"),
        editable: false,
        enabled: isXTcoFetchEnabled(env)
      }
    },
    telegram: {
      active: notifierEnabled && tokenConfigured && ownerUserIdsConfigured,
      reason: telegramReason,
      botToken: {
        envVar: "TELEGRAM_BOT_TOKEN",
        source: diagnosticSource(env, "TELEGRAM_BOT_TOKEN"),
        editable: false,
        configured: tokenConfigured
      },
      ownerUserIds: {
        envVar: "TELEGRAM_OWNER_USER_IDS",
        source: diagnosticSource(env, "TELEGRAM_OWNER_USER_IDS"),
        editable: false,
        configured: ownerUserIdsConfigured,
        count: ownerUserIds.size
      },
      notifier: {
        envVar: "OPENCLAW_TELEGRAM_NOTIFIER",
        source: diagnosticSource(env, "OPENCLAW_TELEGRAM_NOTIFIER"),
        editable: false,
        enabled: notifierEnabled
      }
    }
  };
}

function buildConfigFieldMeta(
  resolved: ArtistRuntimeConfig,
  env: NodeJS.ProcessEnv = process.env
): ConfigFieldMetaMap {
  const meta: ConfigFieldMetaMap = {
    "dashboard.baseUrl": configField(),
    "autopilot.dryRun": configField(),
    "music.suno.connectionMode": configField(),
    "music.suno.driver": configField(),
    "music.suno.submitMode": configField(),
    "aiReview.provider": configField()
  };

  if (env.OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE?.trim().toLowerCase() === "off") {
    meta["autopilot.dryRun"] = configField("env", "OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE");
  }

  const sunoDisabled = isSunoLiveDisabled(env);
  const sunoEnabled = !sunoDisabled && isSunoLiveEnabled(env);
  const submitMode = envValue(env, "OPENCLAW_SUNO_SUBMIT_MODE")?.toLowerCase();
  if (sunoDisabled) {
    meta["music.suno.driver"] = configField("env", env.OPENCLAW_SUNO_LIVE?.trim().toLowerCase() === "off" ? "OPENCLAW_SUNO_LIVE" : "OPENCLAW_SUNO_DRIVER");
    meta["music.suno.submitMode"] = configField("env", env.OPENCLAW_SUNO_LIVE?.trim().toLowerCase() === "off" ? "OPENCLAW_SUNO_LIVE" : "OPENCLAW_SUNO_DRIVER");
  } else if (sunoEnabled) {
    const sourceVar = envValue(env, "OPENCLAW_SUNO_LIVE") ? "OPENCLAW_SUNO_LIVE" : "OPENCLAW_SUNO_DRIVER";
    meta["music.suno.connectionMode"] = configField("env", sourceVar);
    meta["music.suno.driver"] = configField("env", sourceVar);
    meta["music.suno.submitMode"] = configField("env", sourceVar);
  }
  if (!sunoDisabled && (submitMode === "live" || submitMode === "skip")) {
    meta["music.suno.submitMode"] = configField("env", "OPENCLAW_SUNO_SUBMIT_MODE");
  }

  const providerOverride = envValue(env, "OPENCLAW_AI_REVIEW_PROVIDER")?.toLowerCase();
  if (providerOverride === "mock" || providerOverride === "openclaw" || providerOverride === "openai-codex") {
    meta["aiReview.provider"] = configField("env", "OPENCLAW_AI_REVIEW_PROVIDER");
  }

  if (!resolved.dashboard.baseUrl?.trim() && envValue(env, "OPENCLAW_DASHBOARD_BASE_URL")) {
    meta["dashboard.baseUrl"] = configField("env", "OPENCLAW_DASHBOARD_BASE_URL", true);
  }

  return meta;
}

export async function buildConfigResponse(config?: Partial<ArtistRuntimeConfig>) {
  const resolved = await resolveRuntimeConfig(config);
  const dashboardBaseUrl = getDashboardBaseUrl(resolved) ?? "";
  return {
    ...resolved,
    dashboard: {
      ...resolved.dashboard,
      baseUrl: dashboardBaseUrl
    },
    diagnostics: buildRuntimeDiagnostics(),
    fieldMeta: buildConfigFieldMeta(resolved)
  };
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
    birdDailyMax: RuntimeOverrideField;
    birdMinIntervalMinutes: RuntimeOverrideField;
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
    bird?: { rateLimits?: { dailyMax?: unknown; minIntervalMinutes?: unknown } };
  };
  const bird = await readBirdRateLimitStatus(root);
  const envBirdDailyMax = getBirdDailyMaxOverride();
  const envBirdMinInterval = getBirdMinIntervalMinutesOverride();

  return {
    raw,
    values: {
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
      })
    }
  };
}

function validateRuntimeOverridePayload(payload: Record<string, unknown>): string[] {
  const allowedRoot = new Set(["requestMethod", "requestPath", "config", "bird"]);
  const errors: string[] = [];
  for (const key of Object.keys(payload)) {
    if (!allowedRoot.has(key)) {
      errors.push(`unknown override key: ${key}`);
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

export function runtimeSafetyPatchFromPayload(payload: Record<string, unknown>): { patch?: RuntimeSafetyOverridesPatch; errors: string[] } {
  const errors = validateRuntimeOverridePayload(payload);
  const bird = payload.bird as { rateLimits?: { dailyMax?: unknown; minIntervalMinutes?: unknown } } | undefined;
  const dailyMax = integerInRange(bird?.rateLimits?.dailyMax, "bird.rateLimits.dailyMax", 1, 100, errors);
  const minIntervalMinutes = integerInRange(bird?.rateLimits?.minIntervalMinutes, "bird.rateLimits.minIntervalMinutes", 1, 1440, errors);
  if (errors.length > 0) {
    return { errors };
  }
  return {
    errors: [],
    patch: {
      ...(dailyMax !== undefined || minIntervalMinutes !== undefined
        ? { bird: { rateLimits: { ...(dailyMax !== undefined ? { dailyMax } : {}), ...(minIntervalMinutes !== undefined ? { minIntervalMinutes } : {}) } } }
        : {})
    }
  };
}

export async function appendConfigOverridesAudit(
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
    ? { ...autopilot, nextAction: draftBoxAction.nextAction, nextActionSummary: draftBoxAction }
    : autopilot;
  const platforms = await buildPlatformStatuses(mergedConfig);
  const alerts = await collectAlerts(mergedConfig.artist.workspaceRoot, sunoWorker, platforms, mergedConfig);
  const sunoBudgetTracker = new SunoBudgetTracker(mergedConfig.artist.workspaceRoot);
  const [sunoBudgetState, sunoBudgetResetHistory, sunoArtifacts, birdRateLimit, birdLedger, distributionDetection, pendingApprovals, pendingCallbacks, failedNotifications] = await Promise.all([
    sunoBudgetTracker.getState(
      mergedConfig.music.suno.dailyCreditLimit,
      mergedConfig.music.suno.monthlyCreditLimit
    ),
    sunoBudgetTracker.getResetHistory(10),
    buildSunoArtifactIndex(mergedConfig.artist.workspaceRoot),
    readBirdRateLimitStatus(mergedConfig.artist.workspaceRoot),
    readBirdLedgerDetail(mergedConfig.artist.workspaceRoot),
    readDistributionDetectionState(mergedConfig.artist.workspaceRoot),
    listPendingProposals(mergedConfig.artist.workspaceRoot),
    summarizePendingCallbackActions(mergedConfig.artist.workspaceRoot, 8),
    summarizeFailedNotifications(mergedConfig.artist.workspaceRoot, 8)
  ]);
  const [musicSummary, distributionSummary, awaitingSunoTakeUrlReady] = await Promise.all([
    buildMusicSummary(mergedConfig),
    buildDistributionSummary(mergedConfig, platforms),
    buildAwaitingSunoTakeUrlReady(mergedConfig.artist.workspaceRoot)
  ]);
  const [recentDistributionEvents, platformStats, runtimeEventsLedger, telegramInbound, observationDiagnostics] = await Promise.all([
    readDistributionEvents(mergedConfig.artist.workspaceRoot, 20),
    buildPlatformStats(mergedConfig.artist.workspaceRoot),
    readRuntimeEvents(mergedConfig.artist.workspaceRoot, 20),
    readReceiveHealth(mergedConfig.artist.workspaceRoot),
    readXObservationDiagnostics(mergedConfig.artist.workspaceRoot)
  ]);
  const setupReadiness = await buildSetupReadiness(mergedConfig, autopilotStatus, sunoWorker, platforms, workspaceStatus);
  const effectiveDryRunMap = buildEffectiveDryRunMap(mergedConfig);
  const statusSunoBudget = {
    ...sunoBudgetState,
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
    observationDiagnostics,
    distribution: {
      detected: distributionDetection.detected
    },
    pendingApprovals: {
      count: pendingApprovals.length,
      recent: pendingApprovals.slice(0, 3)
    },
    pendingCallbacks,
    failedNotifications,
    awaitingSunoTakeUrlReady,
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
      dashboardBaseUrl: getDashboardBaseUrl(config, env)
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
