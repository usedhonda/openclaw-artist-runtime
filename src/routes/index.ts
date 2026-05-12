import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InstagramConnector } from "../connectors/social/instagramConnector.js";
import { TikTokConnector } from "../connectors/social/tiktokConnector.js";
import { XBirdConnector } from "../connectors/social/xBirdConnector.js";
import { BrowserWorkerSunoConnector } from "../connectors/suno/browserWorkerConnector.js";
import { safeRegisterRoute } from "../pluginApi.js";
import { acknowledgeAlert } from "../services/alertAcks.js";
import { collectAlerts } from "../services/alerts.js";
import { appendAuditLog, createAuditEvent } from "../services/auditLog.js";
import { listSongStates, readArtistMind, readSongState } from "../services/artistState.js";
import { ArtistAutopilotService, pauseAutopilot, resumeAutopilot } from "../services/autopilotService.js";
import { AutopilotControlService } from "../services/autopilotControlService.js";
import { getAutopilotTicker, getAutopilotTickerIntervalMs, getLastOutcome, getLastTickAt } from "../services/autopilotTicker.js";
import { readBirdLedgerDetail, readBirdRateLimitStatus } from "../services/birdRateLimiter.js";
import { resolveCallbackAction } from "../services/callbackActionRegistry.js";
import { handleProposalResponse, listPendingProposalDetails, listPendingProposals } from "../services/conversationalSession.js";
import { buildPlatformStats, readDistributionEvents } from "../services/distributionLedgerReader.js";
import { getRuntimeEventBus } from "../services/runtimeEventBus.js";
import { readRuntimeEvents, readSongEventsAsc } from "../services/runtimeEventsLedger.js";
import { getSongPromptLedgerPath } from "../services/promptLedger.js";
import { isDebugCallbackDispatchEnabled, mergeResolvedConfig, patchResolvedConfig, readConfigOverrides, resolveRuntimeConfig, resolveSunoDailyBudget, writeRuntimeSafetyOverrides, type RuntimeSafetyOverridesPatch } from "../services/runtimeConfig.js";
import { publishSocialAction, readLatestSocialAction } from "../services/socialPublishing.js";
import { SocialDistributionWorker } from "../services/socialDistributionWorker.js";
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
import { SunoBrowserWorker } from "../services/sunoBrowserWorker.js";
import { createSongIdea } from "../services/songIdeation.js";
import { buildSongbookLookup, syncSongbookFromITunes } from "../services/songbookSyncer.js";
import { readTakeHistory, selectTake } from "../services/takeSelection.js";
import { routeTelegramCallback } from "../services/telegramCallbackHandler.js";
import type { TelegramClient } from "../services/telegramClient.js";
import { serializeRuntimeEventForSse, registerRuntimeEventStreamRoute } from "./runtimeEventStream.js";
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
  StatusResponse,
  StatusExportResponse,
  ObservabilityExportWindow,
  SunoStatusResponse,
  SunoRunRecord,
  SunoDiagnosticsExportResponse,
  SunoDiagnosticsImportOutcome
} from "../types.js";
import { instagramAuthorityModes, tiktokAuthorityModes, xAuthorityModes } from "../types.js";

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

function payloadRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

function normalizeRequestPath(path: string): string {
  if (path === "/") {
    return path;
  }
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

function payloadRequestPath(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.requestPath === "string" ? normalizeRequestPath(payload.requestPath) : fallback;
}

function payloadRequestMethod(payload: Record<string, unknown>, fallback: "GET" | "POST" | "PATCH" = "GET"): "GET" | "POST" | "PATCH" {
  const method = typeof payload.requestMethod === "string" ? payload.requestMethod.toUpperCase() : fallback;
  return method === "POST" || method === "PATCH" ? method : "GET";
}

function payloadPathSegments(payload: Record<string, unknown>, prefix: string): string[] {
  const normalizedPrefix = normalizeRequestPath(prefix);
  const requestPath = payloadRequestPath(payload, normalizedPrefix);
  if (requestPath === normalizedPrefix) {
    return [];
  }
  if (!requestPath.startsWith(`${normalizedPrefix}/`)) {
    return [];
  }
  return requestPath
    .slice(normalizedPrefix.length + 1)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function platformFromSegment(value: unknown): SocialPlatform | undefined {
  return value === "instagram" || value === "tiktok" || value === "x" ? value : undefined;
}

function exportWindowFromInput(value: unknown): ObservabilityExportWindow {
  return value === "30d" || value === "all" ? value : "7d";
}

function exportWindowFromPayload(payload: Record<string, unknown>): ObservabilityExportWindow {
  if (typeof payload.window === "string") {
    return exportWindowFromInput(payload.window);
  }
  const requestPath = payloadRequestPath(payload, "/plugins/artist-runtime/api/status/export");
  const queryIndex = requestPath.indexOf("?");
  if (queryIndex < 0) {
    return "7d";
  }
  return exportWindowFromInput(new URLSearchParams(requestPath.slice(queryIndex + 1)).get("window"));
}

function payloadInteger(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = payload[key];
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function optionalInteger(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function isLocalRoutePayload(payload: Record<string, unknown>): boolean {
  const remote = typeof payload.remoteAddress === "string" ? payload.remoteAddress.trim() : "";
  return remote === "" || remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

const internalCallbackTelegramClient: TelegramClient = {
  answerCallbackQuery: async () => true,
  editMessageReplyMarkup: async () => true,
  editMessageText: async () => true,
  sendMessage: async (chatId: number | string) => ({ message_id: 0, chat: { id: Number(chatId) } })
} as unknown as TelegramClient;

function sunoDiagnosticsDaysFromPayload(payload: Record<string, unknown>): number {
  return Math.min(30, Math.max(1, payloadInteger(payload, "days", 7)));
}

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
  const [state, brief, promptLedger, sunoRuns, latestSocialAction, selectedTake, socialAssets, latestPromptPack, takeHistory] = await Promise.all([
    readSongState(workspaceRoot, songId),
    readTextOrFallback(join(workspaceRoot, "songs", songId, "brief.md"), "", "song_brief_missing", "debug"),
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

function positiveIntegerFromEnv(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
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
  const envSuno = positiveIntegerFromEnv(process.env.OPENCLAW_SUNO_DAILY_BUDGET);
  const envBirdDailyMax = positiveIntegerFromEnv(process.env.OPENCLAW_BIRD_DAILY_MAX);
  const envBirdMinInterval = positiveIntegerFromEnv(process.env.OPENCLAW_BIRD_MIN_INTERVAL_MINUTES);
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
  const worker = await new BrowserWorkerSunoConnector(workspaceRoot, { config: mergedConfig }).status();
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
    latestPromptPackMetadata: latestPromptPack?.metadata
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
  const sunoWorker = await new BrowserWorkerSunoConnector(mergedConfig.artist.workspaceRoot, { config: mergedConfig }).status();
  const distributionWorker = await new SocialDistributionWorker().status(mergedConfig);
  const workspaceStatus = await buildWorkspaceSummaries(mergedConfig.artist.workspaceRoot);
  const platforms = await buildPlatformStatuses(mergedConfig);
  const alerts = await collectAlerts(mergedConfig.artist.workspaceRoot, sunoWorker, platforms, mergedConfig);
  const sunoBudgetTracker = new SunoBudgetTracker(mergedConfig.artist.workspaceRoot);
  const [sunoBudgetState, sunoBudgetResetHistory, sunoArtifacts, sunoDailyBudget, sunoBudgetDetail, birdRateLimit, birdLedger, distributionDetection, pendingApprovals] = await Promise.all([
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
    listPendingProposals(mergedConfig.artist.workspaceRoot)
  ]);
  const [musicSummary, distributionSummary] = await Promise.all([
    buildMusicSummary(mergedConfig),
    buildDistributionSummary(mergedConfig, platforms)
  ]);
  const [recentDistributionEvents, platformStats, runtimeEventsLedger] = await Promise.all([
    readDistributionEvents(mergedConfig.artist.workspaceRoot, 20),
    buildPlatformStats(mergedConfig.artist.workspaceRoot),
    readRuntimeEvents(mergedConfig.artist.workspaceRoot, 20)
  ]);
  const setupReadiness = await buildSetupReadiness(mergedConfig, autopilot, sunoWorker, platforms, workspaceStatus);
  const effectiveDryRunMap = buildEffectiveDryRunMap(mergedConfig);
  const rawConfigOverrides = await readConfigOverrides(mergedConfig.artist.workspaceRoot) as { suno?: { dailyBudget?: unknown } };
  const hasRuntimeSunoBudget = positiveIntegerFromEnv(process.env.OPENCLAW_SUNO_DAILY_BUDGET) !== undefined
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
    autopilot,
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
    lastSocialAction: workspaceStatus.lastSocialAction
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
        if (segments.length === 2 && (segments[1] === "songbook-write" || segments[1] === "songbook-skip")) {
          if (payloadContainsSecretLikeText(payload, ["reason", "note"])) {
            return {
              error: "secret_like_payload_rejected",
              statusCode: 400
            };
          }
          return handleSongPublishActionRequest({
            root: config.artist.workspaceRoot,
            songId: segments[0] ?? (typeof payload.songId === "string" ? payload.songId : "song-001"),
            action: segments[1] === "songbook-write" ? "song_songbook_write" : "song_skip",
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

const PLUGIN_ROOT = (() => {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  } catch {
    return process.cwd();
  }
})();

export async function uiBuildIsFresh(projectRoot = PLUGIN_ROOT): Promise<boolean> {
  const uiRoot = join(projectRoot, "ui");
  const distIndexPath = join(uiRoot, "dist", "index.html");
  const distIndexStat = await stat(distIndexPath).catch(() => undefined);
  if (!distIndexStat) {
    return false;
  }

  const sourcePaths = [
    join(uiRoot, "index.html"),
    join(uiRoot, "package.json"),
    join(uiRoot, "vite.config.ts"),
    join(uiRoot, "src", "App.tsx"),
    join(uiRoot, "src", "main.tsx"),
    join(uiRoot, "src", "styles.css")
  ];
  const sourceStats = await Promise.all(sourcePaths.map(async (path) => stat(path).catch(() => undefined)));
  return sourceStats.every((sourceStat) => !sourceStat || sourceStat.mtimeMs <= distIndexStat.mtimeMs);
}

function stripUiBasePath(assetPath: string): string {
  return assetPath.replace(/^\/plugins\/artist-runtime\/ui\//, "").replace(/^\//, "");
}

async function builtProducerConsoleHtml(projectRoot = PLUGIN_ROOT): Promise<string | undefined> {
  try {
    if (!(await uiBuildIsFresh(projectRoot))) {
      return undefined;
    }

    const uiRoot = join(projectRoot, "ui", "dist");
    const indexHtml = await readFile(join(uiRoot, "index.html"), "utf8");
    const cssMatches = Array.from(indexHtml.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)).map((match) => match[1]);
    const scriptMatches = Array.from(indexHtml.matchAll(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g)).map((match) => match[1]);
    const cssChunks = await Promise.all(cssMatches.map(async (href) => readFile(join(uiRoot, stripUiBasePath(href)), "utf8")));
    const scriptChunks = await Promise.all(scriptMatches.map(async (src) => readFile(join(uiRoot, stripUiBasePath(src)), "utf8")));

    const inlineStyles = `<style>${cssChunks.join("\n")}</style></head>`;
    const inlineScripts = `<script type="module">${scriptChunks.join("\n")}</script></body>`;
    return indexHtml
      .replace(/<link[^>]+href="[^"]+\.css"[^>]*>/g, "")
      .replace(/<script[^>]+src="[^"]+\.js"[^>]*><\/script>/g, "")
      .replace("</head>", () => inlineStyles)
      .replace("</body>", () => inlineScripts);
  } catch {
    return undefined;
  }
}

export async function producerConsoleHtml(projectRoot = PLUGIN_ROOT): Promise<string> {
  const built = await builtProducerConsoleHtml(projectRoot);
  if (built) {
    return built;
  }

  const authorityOptions = <T extends string>(modes: readonly T[]) =>
    modes.map((mode) => `<option value="${mode}">${mode}</option>`).join("");
  const xAuthorityOptions = authorityOptions(xAuthorityModes);
  const instagramAuthorityOptions = authorityOptions(instagramAuthorityModes);
  const tiktokAuthorityOptions = authorityOptions(tiktokAuthorityModes);

  return [
    "<!doctype html>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>Artist Runtime</title>",
    "<style>",
    ":root{--bg:#f4efe7;--ink:#1d1a17;--muted:#6c6257;--line:#d5cabc;--card:#fbf7f1;--accent:#9d4f2e;--accent2:#224d4a;font-family:Georgia,'Iowan Old Style',serif}",
    "body{margin:0;background:radial-gradient(circle at top,#fff8ef,transparent 35%),linear-gradient(180deg,#f4efe7,#e8dfd3);color:var(--ink)}",
    "main{max-width:1120px;margin:0 auto;padding:32px 20px 64px}",
    "header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:24px}",
    "h1{margin:0;font-size:clamp(2rem,4vw,3.5rem);letter-spacing:.02em}",
    "p{color:var(--muted)}",
    ".actions{display:flex;gap:8px;flex-wrap:wrap}",
    "button{border:1px solid var(--line);background:var(--card);padding:10px 14px;border-radius:999px;cursor:pointer}",
    "button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}",
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}",
    ".panel{background:rgba(251,247,241,.88);border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 8px 30px rgba(61,40,20,.05)}",
    ".metric{font-size:1.8rem;margin:8px 0 0}",
    ".list{display:grid;gap:10px;margin-top:10px}",
    ".item{padding:12px;border-radius:14px;background:#fff;border:1px solid #e4d8cb}",
    ".config-form{display:grid;gap:10px}",
    ".field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}",
    ".toggle{display:flex;align-items:center;gap:10px}",
    ".warning{padding:12px;border-radius:14px;background:#f4e3c4;color:#996400;border:1px solid rgba(153,100,0,.24)}",
    ".field-error{color:#8f2016;font-weight:600}",
    ".pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#efe2d6;color:var(--accent);font-size:.8rem;margin-right:6px}",
    ".alert{border-left:4px solid var(--accent);padding-left:12px}",
    ".alert.warning{border-color:#a06b08}",
    ".alert.critical{border-color:#8c1d18}",
    ".outcome-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}",
    ".badge{display:inline-block;padding:4px 8px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}",
    ".badge.dry-run{background:rgba(153,100,0,.12);color:#996400;border:1px solid rgba(153,100,0,.22)}",
    ".muted{color:var(--muted)}",
    "pre{white-space:pre-wrap;background:#fff;border:1px solid var(--line);padding:12px;border-radius:14px;overflow:auto}",
    "</style>",
    "<main>",
    "<header><div><p class=\"muted\">Producer Console</p><h1>Artist Runtime</h1><p>Runtime-first control tower for status, songs, alerts, and cycle actions.</p></div><div class=\"actions\"><button id=\"pause\">Pause</button><button id=\"resume\">Resume</button><button class=\"primary\" id=\"run-cycle\">Run Cycle Now</button></div></header>",
    "<section class=\"grid\">",
    "<article class=\"panel\"><div class=\"muted\">Autopilot</div><div class=\"metric\" id=\"autopilot-stage\">-</div><div id=\"autopilot-meta\" class=\"muted\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Ticker</div><div class=\"metric\" id=\"ticker-outcome\">-</div><div id=\"ticker-meta\" class=\"muted\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Suno</div><div class=\"metric\" id=\"suno-state\">-</div><div id=\"suno-meta\" class=\"muted\"></div><div class=\"list\"><div class=\"item\"><div class=\"muted\">Suno Current Run</div><strong id=\"suno-current-run\">-</strong></div><div class=\"item\"><div class=\"muted\">Last Imported</div><strong id=\"suno-last-imported\">-</strong></div><div class=\"item\"><div class=\"outcome-heading\"><div class=\"muted\">Last Create</div><span class=\"badge dry-run\" id=\"suno-last-create-badge\" hidden>Dry-run</span></div><strong id=\"suno-last-create\">-</strong><div id=\"suno-last-create-meta\" class=\"muted\"></div></div><div class=\"item\"><div class=\"outcome-heading\"><div class=\"muted\">Last Import</div><span class=\"badge dry-run\" id=\"suno-last-import-badge\" hidden>Dry-run</span></div><strong id=\"suno-last-import\">-</strong><div id=\"suno-last-import-meta\" class=\"muted\"></div></div></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Music Budget</div><div class=\"metric\" id=\"music-budget\">-</div><div id=\"music-meta\" class=\"muted\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Distribution</div><div class=\"metric\" id=\"distribution-meta\">-</div><div id=\"platform-meta\" class=\"muted\"></div></article>",
    "</section>",
    "<section class=\"grid\" style=\"margin-top:16px\">",
    "<article class=\"panel\"><div class=\"muted\">Songs</div><div id=\"songs\" class=\"list\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Alerts</div><div id=\"alerts\" class=\"list\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Current Song Detail</div><div id=\"song-detail\" class=\"list\"></div></article>",
    "</section>",
    "<section class=\"grid\" style=\"margin-top:16px\">",
    "<article class=\"panel\"><div class=\"muted\">Recent X Result</div><div id=\"recent-x-result\" class=\"list\"></div></article>",
    "<article class=\"panel\"><div class=\"muted\">Simulate Reply</div><form id=\"reply-form\" class=\"list\"><input id=\"reply-target\" placeholder=\"target tweet id or URL\" /><textarea id=\"reply-text\" placeholder=\"reply text\" rows=\"4\"></textarea><button class=\"primary\" type=\"submit\">Simulate Dry-Run Reply</button></form></article>",
    "</section>",
    "<section class=\"grid\" style=\"margin-top:16px\">",
    `<article class="panel"><div class="muted">Config Editor</div><form id="config-form" class="config-form"><label class="toggle"><input id="cfg-autopilot-enabled" type="checkbox" />Autopilot enabled</label><label class="toggle"><input id="cfg-dry-run" type="checkbox" />Dry-run safety</label><div id="cfg-dry-run-warning" class="warning" hidden>Dry-run is OFF. The runtime stays fail-closed, but this arm can permit live side effects if the connectors are ready.</div><div class="field-grid"><label><div class="muted">Songs Per Week</div><input id="cfg-songs-per-week" type="number" min="0" max="21" /></label><label><div class="muted">Cycle Interval Minutes</div><input id="cfg-cycle-interval" type="number" min="15" max="1440" /></label></div><div class="field-grid"><label><div class="toggle"><input id="cfg-x-enabled" type="checkbox" />X enabled</div><div class="muted">X Authority</div><select id="cfg-x-authority">${xAuthorityOptions}</select></label><label><div class="toggle"><input id="cfg-instagram-enabled" type="checkbox" />Instagram enabled</div><div class="muted">Instagram Authority</div><select id="cfg-instagram-authority">${instagramAuthorityOptions}</select></label><label><div class="toggle"><input id="cfg-tiktok-enabled" type="checkbox" />TikTok enabled</div><div class="muted">TikTok Authority</div><select id="cfg-tiktok-authority">${tiktokAuthorityOptions}</select></label></div><div class="muted" id="cfg-meta"></div><div id="config-error" class="field-error"></div><div class="actions"><button class="primary" id="config-save" type="submit">Save Settings</button><button id="config-reset" type="button">Reset Draft</button><button id="config-refresh" type="button">Refresh</button></div></form></article>`,
    "</section>",
    "<section class=\"panel\" style=\"margin-top:16px\"><div class=\"muted\">API Debug</div><pre id=\"debug\">loading...</pre></section>",
    "<script type=\"module\">",
    "const base='/plugins/artist-runtime/api';",
    "let configDirty=false;",
    "async function get(path){const res=await fetch(base+path);if(!res.ok) throw new Error(path+' '+res.status);return res.json();}",
    "async function post(path,body={}){const res=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!res.ok) throw new Error(path+' '+res.status);return res.json();}",
    "function text(id,value){document.getElementById(id).textContent=value;}",
    "function html(id,value){document.getElementById(id).innerHTML=value;}",
    "function checked(id){return document.getElementById(id).checked;}",
    "function value(id){return document.getElementById(id).value;}",
    `const xAuthorityModes=${JSON.stringify(xAuthorityModes)};`,
    `const instagramAuthorityModes=${JSON.stringify(instagramAuthorityModes)};`,
    `const tiktokAuthorityModes=${JSON.stringify(tiktokAuthorityModes)};`,
    "function formatOutcome(label,outcome){if(!outcome) return {title:`${label}: none`,detail:'No recorded outcome yet.',dryRun:false}; const status=outcome.accepted===false?'blocked':'accepted'; const runId=outcome.runId??'unknown'; const reason=outcome.reason??(typeof outcome.urlCount==='number'?`${outcome.urlCount} urls imported`:'no reason'); const at=outcome.at??'time unknown'; return {title:`${label}: ${status} (${runId})`,detail:`${reason} · ${at}`,dryRun:Boolean(outcome.dryRun)};}",
    "function renderSongs(songs){html('songs',songs.length?songs.map(song=>`<div class=\"item\"><span class=\"pill\">${song.status}</span><strong>${song.title}</strong><div class=\"muted\">${song.songId} · runs ${song.runCount}</div></div>`).join(''):'<div class=\"item muted\">No songs yet.</div>')}",
    "function renderAlerts(alerts){html('alerts',alerts.length?alerts.map(alert=>`<div class=\"item alert ${alert.severity}\"><strong>${alert.message}</strong><div class=\"muted\">${alert.source}${alert.ackedAt?' · acknowledged':''}</div></div>`).join(''):'<div class=\"item muted\">No active alerts.</div>')}",
    "function renderSongDetail(detail){if(!detail||!detail.song){html('song-detail','<div class=\"item muted\">No current song.</div>');return;} html('song-detail',`<div class=\"item\"><strong>${detail.song.title}</strong><div class=\"muted\">${detail.song.songId} · ${detail.song.status}</div></div><div class=\"item\"><div class=\"muted\">Prompt Ledger</div><strong>${detail.promptLedger.length} entries</strong></div><div class=\"item\"><div class=\"muted\">Suno Runs</div><strong>${detail.sunoRuns.length}</strong></div><div class=\"item\"><div class=\"muted\">Latest Prompt Pack</div><strong>${detail.latestPromptPack?`v${detail.latestPromptPack.version}`:'none'}</strong></div>`)}",
    "function renderRecentX(status){const action=status.lastSocialAction; if(!action||action.platform!=='x'){html('recent-x-result','<div class=\"item muted\">No X result yet.</div>'); return;} html('recent-x-result',`<div class=\"item\"><strong>${action.action}</strong><div class=\"muted\">${action.accepted?'accepted':'blocked'} · ${action.reason??'no reason'}</div><div class=\"muted\">${action.url??'no url'}</div></div>`)}",
    "function syncConfigForm(config){if(configDirty) return; document.getElementById('cfg-autopilot-enabled').checked=Boolean(config.autopilot.enabled); document.getElementById('cfg-dry-run').checked=Boolean(config.autopilot.dryRun); document.getElementById('cfg-songs-per-week').value=String(config.autopilot.songsPerWeek ?? 0); document.getElementById('cfg-cycle-interval').value=String(config.autopilot.cycleIntervalMinutes ?? 180); document.getElementById('cfg-x-enabled').checked=Boolean(config.distribution.platforms.x.enabled); document.getElementById('cfg-x-authority').value=String(config.distribution.platforms.x.authority ?? 'draft_only'); document.getElementById('cfg-instagram-enabled').checked=Boolean(config.distribution.platforms.instagram.enabled); document.getElementById('cfg-instagram-authority').value=String(config.distribution.platforms.instagram.authority ?? 'draft_only'); document.getElementById('cfg-tiktok-enabled').checked=Boolean(config.distribution.platforms.tiktok.enabled); document.getElementById('cfg-tiktok-authority').value=String(config.distribution.platforms.tiktok.authority ?? 'draft_only'); text('cfg-meta',`artist ${config.artist.artistId} · workspace ${config.artist.workspaceRoot}`); document.getElementById('cfg-dry-run-warning').hidden=Boolean(config.autopilot.dryRun); text('config-error','');}",
    "function buildConfigPatch(){const songsPerWeek=Number(value('cfg-songs-per-week')); const cycleIntervalMinutes=Number(value('cfg-cycle-interval')); const xAuthority=value('cfg-x-authority'); const instagramAuthority=value('cfg-instagram-authority'); const tiktokAuthority=value('cfg-tiktok-authority'); if(!Number.isInteger(songsPerWeek)||songsPerWeek<0||songsPerWeek>21) throw new Error('songsPerWeek must be between 0 and 21'); if(!Number.isInteger(cycleIntervalMinutes)||cycleIntervalMinutes<15||cycleIntervalMinutes>1440) throw new Error('cycleIntervalMinutes must be between 15 and 1440'); if(!xAuthorityModes.includes(xAuthority)) throw new Error('xAuthority must be one of the supported X authority modes'); if(!instagramAuthorityModes.includes(instagramAuthority)) throw new Error('instagramAuthority must be one of the supported Instagram authority modes'); if(!tiktokAuthorityModes.includes(tiktokAuthority)) throw new Error('tiktokAuthority must be one of the supported TikTok authority modes'); return {autopilot:{enabled:checked('cfg-autopilot-enabled'),dryRun:checked('cfg-dry-run'),songsPerWeek,cycleIntervalMinutes},distribution:{platforms:{x:{enabled:checked('cfg-x-enabled'),authority:xAuthority},instagram:{enabled:checked('cfg-instagram-enabled'),authority:instagramAuthority},tiktok:{enabled:checked('cfg-tiktok-enabled'),authority:tiktokAuthority}}}};}",
    "async function refresh(){const [status,songs,alerts,config,suno]=await Promise.all([get('/status'),get('/songs'),get('/alerts'),get('/config'),get('/suno/status')]); text('autopilot-stage',status.autopilot.stage); text('autopilot-meta',`${status.autopilot.nextAction} · run ${status.autopilot.currentRunId??'none'}`); text('ticker-outcome',status.ticker.lastOutcome??'never'); text('ticker-meta',status.ticker.lastTickAt?`${status.ticker.lastTickAt} · ${status.ticker.intervalMs}ms`:`interval ${status.ticker.intervalMs}ms`); text('suno-state',suno.worker.state); text('suno-meta',suno.worker.pendingAction??suno.worker.hardStopReason??'worker ready'); text('suno-current-run',suno.currentRunId??suno.worker.currentRunId??'-'); text('suno-last-imported',suno.lastImportedRunId??suno.worker.lastImportedRunId??'-'); const createOutcome=formatOutcome('Last Create',suno.lastCreateOutcome??suno.worker.lastCreateOutcome); text('suno-last-create',createOutcome.title); text('suno-last-create-meta',createOutcome.detail); document.getElementById('suno-last-create-badge').hidden=!createOutcome.dryRun; const importOutcome=formatOutcome('Last Import',suno.lastImportOutcome??suno.worker.lastImportOutcome); text('suno-last-import',importOutcome.title); text('suno-last-import-meta',importOutcome.detail); document.getElementById('suno-last-import-badge').hidden=!importOutcome.dryRun; text('music-budget',`${status.musicSummary.monthlyRuns}/${status.musicSummary.monthlyGenerationBudget}`); text('music-meta',`today ${status.musicSummary.dailyRuns} · prompt pack ${status.musicSummary.latestPromptPackVersion??'none'}`); text('distribution-meta',`posts ${status.distributionSummary.postsToday} · replies ${status.distributionSummary.repliesToday}`); text('platform-meta',Object.entries(status.platforms).map(([id,p])=>`${id}:${p.connected?'connected':'offline'}`).join(' · ')); renderSongs(songs); renderAlerts(alerts); renderRecentX(status); syncConfigForm(config); if(status.recentSong){document.getElementById('reply-form').dataset.songId=status.recentSong.songId; renderSongDetail(await get('/songs/'+status.recentSong.songId));} else {document.getElementById('reply-form').dataset.songId=''; renderSongDetail(null);} text('debug',JSON.stringify(status,null,2)); }",
    "document.getElementById('pause').addEventListener('click',async()=>{await post('/pause');await refresh();});",
    "document.getElementById('resume').addEventListener('click',async()=>{await post('/resume');await refresh();});",
    "document.getElementById('run-cycle').addEventListener('click',async()=>{await post('/run-cycle');await refresh();});",
    "document.getElementById('reply-form').addEventListener('submit',async(event)=>{event.preventDefault(); const songId=event.currentTarget.dataset.songId; if(!songId) return; await post('/platforms/x/simulate-reply',{songId,targetId:document.getElementById('reply-target').value,text:document.getElementById('reply-text').value}); await refresh();});",
    "document.querySelectorAll('#config-form input, #config-form select').forEach((input)=>{const markDirty=()=>{configDirty=true; document.getElementById('cfg-dry-run-warning').hidden=checked('cfg-dry-run');}; input.addEventListener('input',markDirty); input.addEventListener('change',markDirty);});",
    "document.getElementById('config-form').addEventListener('submit',async(event)=>{event.preventDefault(); try{text('config-error',''); await post('/config/update',{patch:buildConfigPatch()}); configDirty=false; await refresh();}catch(error){text('config-error',String(error instanceof Error ? error.message : error));}});",
    "document.getElementById('config-reset').addEventListener('click',async()=>{configDirty=false; await refresh();});",
    "document.getElementById('config-refresh').addEventListener('click',async()=>{configDirty=false; await refresh();});",
    "setInterval(()=>{void refresh().catch(error=>{text('debug',String(error));});},5000);",
    "refresh().catch(error=>{text('debug',String(error));});",
    "</script>",
    "</main>"
  ].join("");
}
