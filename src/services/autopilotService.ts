import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { applyConfigDefaults } from "../config/schema.js";
import { resolveSunoConnector } from "../connectors/suno/resolveSunoConnector.js";
import type { AutopilotRunState, AutopilotStage, AutopilotStatus, ArtistRuntimeConfig, CommissionBrief, CommissionBriefSource, ObservationSummary, SocialPublishLedgerEntry, SocialPublishResult, SongState, SpawnProposal, SunoRunRecord } from "../types.js";
import { composeDailyVoice } from "./artistDailyVoiceComposer.js";
import { markPulsed, shouldPulse } from "./artistPulseRateLimiter.js";
import { AutopilotControlService } from "./autopilotControlService.js";
import {
  defaultAutopilotRunState,
  readAutopilotState,
  writeAutopilotState
} from "./autopilotRecovery.js";
import { listSongStates, readArtistMind, readSongState, updateSongState } from "./artistState.js";
import { createSongIdea } from "./songIdeation.js";
import { draftLyrics } from "./lyricsDrafting.js";
import { prepareSocialAssets } from "./socialAssets.js";
import { createAndPersistSunoPromptPack } from "./sunoPromptPackFiles.js";
import { evaluateSunoGenerationLimits, generateSunoRun, importSunoResults, readLatestSunoRun } from "./sunoRuns.js";
import { publishSocialAction } from "./socialPublishing.js";
import { selectTake } from "./takeSelection.js";
import { evaluateSunoTakeSelection } from "./sunoTakeSelector.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import {
  collectSunoTakeUrls,
  evaluateSunoTakeUrlReadiness,
  SINGLE_TAKE_URL_FALLBACK_REASON,
  type SunoTakeUrlReadiness
} from "./sunoTakeUrls.js";
import { classifySunoGenerateFailure, nextSunoRetryDecision } from "./sunoRetryHandler.js";
import { PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON } from "./sunoPlaywrightDriver.js";
import { collectObservations, type XObservationContext } from "./xObservationCollector.js";
import { collectNewsObservations } from "./newsObservationCollector.js";
import { buildNewsReactionQueries } from "./newsReactionQuery.js";
import { proposeTheme } from "./themeProposer.js";
import { pollSongDistribution } from "./songDistributionPoller.js";
import { cleanupExpiredCallbacks } from "./callbackLedgerMaintenance.js";
import { readCallbackActionEntries } from "./callbackActionRegistry.js";
import { applyRuntimeEnvOverrides, getArtistPulseIntervalHours, getSongSpawnIntervalHours, getStaleQueueCleanupHours, isArtistPulseConfigured, isSongbookAutoSyncEnabled, isSongSpawnConfigured } from "./runtimeConfig.js";
import { proposeSpawn, type ActiveQueueContextEntry } from "./songSpawnProposer.js";
import { appendSpawnProposal, listBuildingSpawnProposals, listPendingSpawnProposals, markSpawnProposalBuilding, markSpawnProposalDone } from "./spawnProposalQueue.js";
import { buildCascadeTrace } from "./cascadeTrace.js";
import { markSpawned, shouldSpawn } from "./songSpawnRateLimiter.js";
import { validatePlanningFiles } from "./planningSkeletonValidator.js";
import { applyChangeSet } from "./changeSetApplier.js";
import { syncSongbookFromITunes } from "./songbookSyncer.js";
import { composeVoiceTopOnly } from "./commandVoiceWrapper.js";
import { runStaleQueueMaintenance, suppressRestartStaleError } from "./staleQueueMaintenance.js";
import {
  appendTakeAttributionAudit,
  findDryRunImportPaths,
  findTakeAttributionCollisions
} from "./takeAttributionGuard.js";
import { emitDraftBoxProactiveNoticeIfNeeded } from "./draftBoxProactiveNotice.js";
import { readPersonaSetupStatus } from "./personaSetupDetector.js";
import { injectCommissionSong } from "./songStateInjector.js";
import { appendDopagakiMoodHint, decideDopagakiVariation } from "./creativeVariationPolicy.js";

export function isPublishBlockedByDryRun(
  result: Pick<SocialPublishResult, "accepted" | "dryRun">,
  entry: Pick<SocialPublishLedgerEntry, "policyDecision">
): boolean {
  if (result.accepted) {
    return false;
  }
  if (result.dryRun === true) {
    return true;
  }
  return entry.policyDecision?.policyDecision === "deny_dry_run";
}

export interface AutopilotTickInput {
  enabled: boolean;
  dryRun: boolean;
  paused?: boolean;
  hardStop?: boolean;
  promptPackReady?: boolean;
  takeSelected?: boolean;
  assetsReady?: boolean;
}

export interface RunAutopilotCycleInput {
  workspaceRoot: string;
  config?: Partial<ArtistRuntimeConfig>;
  manualSeed?: { hint: string; weirdness?: number };
  observationRunner?: XObservationContext["runner"];
}

function nowIso(): string {
  return new Date().toISOString();
}

async function writeStageState(root: string, previous: AutopilotRunState, next: AutopilotRunState): Promise<AutopilotRunState> {
  if (previous.stage !== next.stage || previous.currentSongId !== next.currentSongId) {
    emitRuntimeEvent({
      type: "autopilot_stage_changed",
      songId: next.currentSongId,
      from: previous.stage,
      to: next.stage,
      timestamp: Date.now()
    });
  }
  const written = await writeAutopilotRunState(root, next);
  await emitDraftBoxProactiveNoticeIfNeeded(root, written).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[artist-runtime] draft box proactive notice failed: ${reason}`);
  });
  return written;
}

function isMockSunoGenerationBypass(config: ArtistRuntimeConfig): boolean {
  return config.music.suno.driver === "mock";
}

function isPreGenerationApprovalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OPENCLAW_PRE_GENERATION_APPROVAL?.trim().toLowerCase();
  return value === "on" || value === "1" || value === "true";
}

const PRODUCER_APPROVAL_REQUIRED_STATUSES = new Set<SongState["status"]>(["idea", "brief", "lyrics"]);
export const PRODUCER_REVIEW_SUSPENDED_AT = "producer_review_after_take_selected";
export const PRODUCER_REVIEW_PAUSED_REASON = "take selected after bounded one-shot Suno create; awaiting producer review";

function isPrePromptSongWithoutApprovalGate(song: SongState): boolean {
  return PRODUCER_APPROVAL_REQUIRED_STATUSES.has(song.status);
}

function releaseAfterTakeCompletion(baseState: AutopilotRunState): AutopilotRunState {
  return {
    ...baseState,
    currentSongId: undefined,
    stage: "completed",
    paused: false,
    pausedReason: undefined,
    suspendedAt: undefined,
    blockedReason: undefined,
    lastError: undefined,
    lastSuccessfulStage: "completed"
  };
}

function releaseAfterSunoTakeUrlReady(baseState: AutopilotRunState): AutopilotRunState {
  return {
    ...baseState,
    currentSongId: undefined,
    stage: "idle",
    paused: false,
    pausedReason: undefined,
    suspendedAt: undefined,
    blockedReason: undefined,
    lastError: undefined,
    lastSuccessfulStage: "suno_generation"
  };
}

function takeIdFromSunoUrl(url: string | undefined): string | undefined {
  return url?.match(/https?:\/\/(?:www\.)?suno\.com\/song\/([^/?#]+)/i)?.[1] ?? url;
}

export function shouldEmitOperationalEpisode(existing: AutopilotRunState, marker: string): boolean {
  return existing.blockedReason !== marker && existing.lastError !== marker;
}

const DEFAULT_SUNO_IMPORT_STALL_MS = 20 * 60 * 1000;
const SUNO_IMPORT_NO_URLS_REASON = "playwright_import_no_urls";
const SUNO_IMPORT_NO_URLS_BLOCKED_REASON = `suno_generate_retry:${SUNO_IMPORT_NO_URLS_REASON}`;

function sunoImportStallMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OPENCLAW_SUNO_IMPORT_STALL_MINUTES?.trim();
  if (!raw) {
    return DEFAULT_SUNO_IMPORT_STALL_MS;
  }
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_SUNO_IMPORT_STALL_MS;
  }
  return minutes * 60 * 1000;
}

function isStaleAcceptedSunoRunWithoutUrls(createdAt: string | undefined, now = Date.now()): boolean {
  if (!createdAt) {
    return false;
  }
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) {
    return false;
  }
  return now - createdMs >= sunoImportStallMs();
}

// Suno's lyrics box transiently degrades (5000 -> 1250 maxLength). The driver surfaces
// this as a retryable suno_lyrics_box_degraded reason (not a hard truncation), so the
// autopilot self-heals across ticks instead of hard-pausing for the operator. The cap
// bounds the self-heal window so a genuinely stuck box eventually surfaces to the producer.
export const SUNO_LYRICS_BOX_DEGRADED_MARKER = PLAYWRIGHT_LYRICS_BOX_DEGRADED_REASON;
const SUNO_LYRICS_BOX_DEGRADED_MAX_ATTEMPTS = 8;
export function isDegradedLyricsBoxReason(value?: string | null): boolean {
  return Boolean(value && value.includes(SUNO_LYRICS_BOX_DEGRADED_MARKER));
}

async function hasProducerSpawnApproval(root: string, songId: string): Promise<boolean> {
  const entries = await readCallbackActionEntries(root).catch(() => []);
  return entries.some((entry) => entry.songId === songId && entry.action === "song_spawn_inject" && entry.status === "applied");
}

function firstBriefField(contents: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = contents.match(new RegExp(`^-\\s*${escaped}:\\s*(.+)$`, "im"));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
}

function firstSectionLine(contents: string, heading: string): string | undefined {
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return undefined;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) break;
    if (trimmed && !trimmed.startsWith("-")) return trimmed;
  }
  return undefined;
}

function observationFromBrief(contents: string, song: SongState): ObservationSummary | undefined {
  if (song.observationSummary) return song.observationSummary;
  const url = firstBriefField(contents, ["URL", "Url", "url"]);
  const author = firstBriefField(contents, ["Author", "author"])?.replace(/^@/, "");
  const quote = firstBriefField(contents, ["Quote", "quote"]) ?? firstSectionLine(contents, "Observation source");
  if (!url && !author && !quote) return undefined;
  return { url, author, quote };
}

function sourcesFromObservation(summary?: ObservationSummary): CommissionBriefSource[] | undefined {
  if (!summary?.url) return undefined;
  return [{
    kind: /^https:\/\/(?:x|twitter)\.com\//i.test(summary.url) ? "x" : "news",
    url: summary.url,
    author: summary.author,
    quote: summary.quote
  }];
}

async function commissionBriefFromExistingSong(root: string, song: SongState): Promise<{ brief: CommissionBrief; observationSummary?: ObservationSummary }> {
  const contents = await readFile(join(root, "songs", song.songId, "brief.md"), "utf8").catch(() => "");
  const observationSummary = observationFromBrief(contents, song);
  const briefText = firstSectionLine(contents, "Producer commission")
    ?? firstSectionLine(contents, "Direction")
    ?? song.lastReason
    ?? `${song.title}を曲にする。`;
  const brief: CommissionBrief = {
    songId: song.songId,
    title: song.title || song.songId,
    brief: briefText,
    lyricsTheme: firstBriefField(contents, ["Lyrics theme", "lyricsTheme", "Core theme"]) ?? briefText,
    mood: firstBriefField(contents, ["Mood", "mood"]) ?? "artist decides",
    tempo: firstBriefField(contents, ["Tempo", "tempo"]) ?? "artist decides",
    duration: firstBriefField(contents, ["Duration", "duration"]) ?? "artist decides",
    styleNotes: firstBriefField(contents, ["Style notes", "style", "Style"]) ?? "artist decides",
    sourceText: "existing song awaiting producer spawn approval",
    createdAt: song.createdAt,
    sources: sourcesFromObservation(observationSummary)
  };
  return { brief, observationSummary };
}

async function suspendForProducerSpawnApproval(
  root: string,
  previous: AutopilotRunState,
  song: SongState,
  baseState: AutopilotRunState
): Promise<AutopilotRunState> {
  const proposal = await commissionBriefFromExistingSong(root, song);
  const reason = song.lastReason && song.lastReason !== "brief updated"
    ? song.lastReason
    : proposal.brief.brief;
  const voiceTop = await composeVoiceTopOnly("propose", root, undefined, [], { runId: song.songId }).catch(() => undefined);
  emitRuntimeEvent({
    type: "song_spawn_proposed",
    brief: proposal.brief,
    reason,
    candidateSongId: song.songId,
    voiceTop,
    observationSummary: proposal.observationSummary,
    timestamp: Date.now()
  });
  return writeStageState(root, previous, {
    ...baseState,
    currentSongId: song.songId,
    stage: "planning",
    suspendedAt: "spawn_proposal_ready",
    blockedReason: "spawn_proposal_ready",
    lastError: undefined,
    cycleCount: previous.cycleCount + 1
  });
}

function activeQueueContextFromProposals(proposals: SpawnProposal[]): ActiveQueueContextEntry[] {
  return proposals.map((proposal) => ({
    title: proposal.title,
    coreTheme: proposal.coreTheme,
    observationSources: proposal.observationSources,
    motifRank: proposal.motifRank
  }));
}

function spawnProposalRecordFromGenerated(
  proposal: NonNullable<Awaited<ReturnType<typeof proposeSpawn>>>,
  voiceTop: string | undefined
): SpawnProposal {
  const cascadeTrace = buildCascadeTrace({
    songId: proposal.candidateSongId,
    title: proposal.brief.title,
    artistVoice: voiceTop,
    lyricsTheme: proposal.brief.lyricsTheme,
    styleLayer: proposal.brief.styleNotes,
    observationSummary: proposal.observationSummary,
    commissionSources: proposal.brief.sources
  });
  return {
    proposalId: proposal.candidateSongId,
    createdAt: proposal.brief.createdAt,
    status: "draft",
    title: proposal.brief.title,
    voiceTop: voiceTop ?? "",
    coreTheme: proposal.brief.lyricsTheme || proposal.brief.brief,
    observationSources: cascadeTrace.observationSources,
    cascadeTrace
  };
}

function isProducerReviewOnlyLane(state: AutopilotRunState): boolean {
  void state;
  return false;
}

async function weeklySongLimitBlocked(root: string, config: ArtistRuntimeConfig, now = new Date()): Promise<string | undefined> {
  if (config.autopilot.songsPerWeek <= 0) {
    return "weekly song creation limit is 0";
  }
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const songs = await listSongStates(root);
  const recent = songs.filter((song) => {
    const createdAt = Date.parse(song.createdAt);
    return Number.isFinite(createdAt) && createdAt >= weekAgo && createdAt <= now.getTime();
  });
  return recent.length >= config.autopilot.songsPerWeek
    ? `weekly song creation limit reached (${recent.length}/${config.autopilot.songsPerWeek})`
    : undefined;
}

async function runIdeaQueueLane(
  root: string,
  existing: AutopilotRunState,
  config: ArtistRuntimeConfig,
  options: { preserveCurrentSongLane?: boolean } = {}
): Promise<{ state?: AutopilotRunState; emitted: boolean; skippedForFullQueue: boolean }> {
  const skippedForFullQueue = false;
  let emitted = false;
  await shouldSpawn(root, { minIntervalHours: getSongSpawnIntervalHours(process.env, config) }).then(async (allowed) => {
    if (!allowed) {
      return;
    }
    const personaSetup = await readPersonaSetupStatus(root);
    if (personaSetup.needsSetup) {
      return;
    }
    const pendingProposals = await listPendingSpawnProposals(root);
    if (pendingProposals.length > 0) {
      return;
    }
    const proposal = await proposeSpawn(root, {
      aiReviewProvider: config.aiReview.provider,
      activeQueueContext: activeQueueContextFromProposals(pendingProposals),
      ignoreRecentCompletion: options.preserveCurrentSongLane
    });
    if (!proposal) {
      return;
    }
    const voiceTop = await composeVoiceTopOnly("propose", root, undefined, [], { runId: proposal.candidateSongId }).catch(() => undefined);
    const record = await appendSpawnProposal(root, spawnProposalRecordFromGenerated(proposal, voiceTop));
    await markSpawned(root);
    emitted = true;
    if (!isPreGenerationApprovalEnabled()) {
      await markSpawnProposalBuilding(root, record.proposalId);
      await injectCommissionSong(root, proposal.brief);
      await markSpawnProposalDone(root, record.proposalId);
      return;
    }
    emitRuntimeEvent({
      type: "song_spawn_proposed",
      brief: proposal.brief,
      reason: proposal.reason,
      candidateSongId: proposal.candidateSongId,
      voiceTop,
      observationSummary: proposal.observationSummary,
      timestamp: Date.now()
    });
  }).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[artist-runtime] song spawn proposal failed: ${reason}`);
  });
  if (!emitted) {
    return { emitted, skippedForFullQueue };
  }
  if (!isPreGenerationApprovalEnabled()) {
    return {
      state: await readAutopilotRunState(root),
      emitted,
      skippedForFullQueue
    };
  }
  if (options.preserveCurrentSongLane) {
    return {
      state: await writeStageState(root, existing, {
        ...existing,
        lastRunAt: nowIso()
      }),
      emitted,
      skippedForFullQueue
    };
  }
  return {
    state: await writeStageState(root, existing, {
      ...existing,
      currentSongId: existing.currentSongId,
      stage: existing.currentSongId ? existing.stage : "planning",
      suspendedAt: "spawn_proposal_ready",
      blockedReason: "spawn_proposal_ready",
      lastError: undefined,
      lastRunAt: nowIso()
    }),
    emitted,
    skippedForFullQueue
  };
}

async function isBuildingDraftSong(root: string, songId: string): Promise<boolean> {
  return (await listBuildingSpawnProposals(root)).some((proposal) => proposal.proposalId === songId);
}

async function markBuildingDraftDone(root: string, songId: string): Promise<void> {
  await markSpawnProposalDone(root, songId).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (!reason.startsWith("spawn_proposal_not_found:")) {
      throw error;
    }
  });
}

async function importMockSunoGeneration(root: string, songId: string, state: AutopilotRunState, config: ArtistRuntimeConfig): Promise<void> {
  const runId = `${state.runId ?? songId}-mock`.replace(/[^A-Za-z0-9_-]/g, "-");
  await importSunoResults({
    workspaceRoot: root,
    songId,
    runId,
    urls: [
      `mock://take/${songId}/${runId}/take-1`,
      `mock://take/${songId}/${runId}/take-2`
    ],
    selectedTakeId: "take-1",
    resultRefs: [],
    config
  });
}

export async function writeAutopilotRunState(root: string, state: AutopilotRunState): Promise<AutopilotRunState> {
  return writeAutopilotState(root, state);
}

async function importPendingSunoGeneration(
  root: string,
  songId: string,
  config: ArtistRuntimeConfig,
  existing?: AutopilotRunState
): Promise<{ imported: true } | { imported: false; reason?: string; pause?: true } | undefined> {
  const connector = resolveSunoConnector(root, config);
  const latestRun = await readLatestSunoRun(root, songId);
  const workerStatus = await connector.status().catch(() => undefined);
  const hasAcceptedRun = latestRun?.status === "accepted";
  if (!hasAcceptedRun && workerStatus?.state !== "generating") {
    return undefined;
  }

  // Prefer the song's own accepted run id. This import is scoped to one songId,
  // but worker.currentRunId is global: once the lane advances to the next song
  // while this song's takes are still pending, falling back to worker.currentRunId
  // mismatches latestRun (urls=[]) and wedges on "waiting for Suno result import"
  // forever (cross-song attribution wedge).
  const runId = hasAcceptedRun && latestRun?.runId
    ? latestRun.runId
    : workerStatus?.currentRunId ?? latestRun?.runId;
  if (!runId) {
    return { imported: false, reason: "suno_import_missing_run_id" };
  }

  const urls = latestRun?.runId === runId ? latestRun.urls : [];
  if (hasAcceptedRun) {
    const reason = `suno_lifecycle_contract_pending_import:${runId}`;
    console.error(`[artist-runtime] ${reason}`);
    emitRuntimeEvent({
      type: "error",
      source: "suno_lifecycle_contract",
      reason,
      songId,
      timestamp: Date.now()
    });
  }
  if (urls.length === 0) {
    if (hasAcceptedRun && isStaleAcceptedSunoRunWithoutUrls(latestRun?.createdAt)) {
      if (!existing || shouldEmitOperationalEpisode(existing, SUNO_IMPORT_NO_URLS_BLOCKED_REASON)) {
        emitRuntimeEvent({
          type: "suno_generate_retry",
          songId,
          reason: SUNO_IMPORT_NO_URLS_REASON,
          retryCount: existing ? existing.retryCount + 1 : 1,
          timestamp: Date.now()
        });
      }
      return { imported: false, reason: SUNO_IMPORT_NO_URLS_BLOCKED_REASON };
    }
    return { imported: false, reason: "waiting for Suno result import" };
  }

  const existingCollisions = await findTakeAttributionCollisions(root, songId, urls);
  if (existingCollisions.length > 0) {
    await appendTakeAttributionAudit(root, "take_attribution_collision_blocked", { songId, runId, collisions: existingCollisions });
    emitRuntimeEvent({
      type: "error",
      source: "take_attribution",
      reason: "take_attribution_collision_blocked",
      songId,
      timestamp: Date.now()
    });
    return { imported: false, reason: "take_attribution_collision_blocked", pause: true };
  }

  const result = await connector.importResults({ runId, urls });
  if (result.urls.length === 0) {
    return { imported: false, reason: result.reason ?? "waiting for Suno result import" };
  }
  const dryRunPaths = findDryRunImportPaths(result.paths ?? []);
  if (dryRunPaths.length > 0) {
    await appendTakeAttributionAudit(root, "dryrun_take_import_blocked", { songId, runId, paths: dryRunPaths });
    emitRuntimeEvent({
      type: "error",
      source: "take_attribution",
      reason: "dryrun_take_import_blocked",
      songId,
      timestamp: Date.now()
    });
    return { imported: false, reason: "dryrun_take_import_blocked", pause: true };
  }
  const collisions = await findTakeAttributionCollisions(root, songId, result.urls);
  if (collisions.length > 0) {
    await appendTakeAttributionAudit(root, "take_attribution_collision_blocked", { songId, runId, collisions });
    emitRuntimeEvent({
      type: "error",
      source: "take_attribution",
      reason: "take_attribution_collision_blocked",
      songId,
      timestamp: Date.now()
    });
    return { imported: false, reason: "take_attribution_collision_blocked", pause: true };
  }

  await importSunoResults({
    workspaceRoot: root,
    songId,
    runId: result.runId ?? runId,
    urls: result.urls,
    selectedTakeId: result.selectedTakeId,
    resultRefs: result.paths ?? [],
    metadata: result.metadata,
    config
  });
  return { imported: true };
}

// While an accepted run has only one of its two take URLs, hold delivery so the
// suno_take_url_ready notification never fires with a single URL when the second is (or
// will imminently be) available. This runs before the audio import-first path because a
// suno_running song with one captured URL would otherwise try to import audio and never
// surface the URL-ready notification. Once the bounded fallback window elapses, the single
// URL is delivered rather than never delivering (fail-open).
const AWAITING_SECOND_SUNO_TAKE_URL_REASON = "awaiting_second_suno_take_url";

async function holdSingleSunoTakeUrl(
  root: string,
  existing: AutopilotRunState,
  baseState: AutopilotRunState,
  song: SongState
): Promise<AutopilotRunState | undefined> {
  if (song.status === "suno_take_url_ready") {
    return undefined;
  }
  const latestRun = await readLatestSunoRun(root, song.songId).catch(() => undefined);
  if (latestRun?.status !== "accepted") {
    return undefined;
  }
  // Only the exactly-one-take-URL case is handled here. Zero URLs falls through to the
  // audio import-first recovery, and >= expected URLs is delivered by the normal paths.
  if (collectSunoTakeUrls(latestRun.urls).length !== 1) {
    return undefined;
  }
  const readiness = evaluateSunoTakeUrlReadiness(latestRun.urls, Date.parse(latestRun.createdAt), Date.now());
  if (!readiness.emit) {
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: song.songId,
      stage: "suno_generation",
      blockedReason: AWAITING_SECOND_SUNO_TAKE_URL_REASON,
      lastError: undefined,
      lastSuccessfulStage: existing.lastSuccessfulStage,
      cycleCount: existing.cycleCount + 1
    });
  }
  return deliverSunoTakeUrlReady(root, existing, baseState, song, latestRun, readiness);
}

async function recoverAcceptedRunUrlReady(
  root: string,
  existing: AutopilotRunState,
  baseState: AutopilotRunState,
  song: SongState
): Promise<AutopilotRunState | undefined> {
  if (song.status === "suno_take_url_ready") {
    return undefined;
  }
  const latestRun = await readLatestSunoRun(root, song.songId).catch(() => undefined);
  if (latestRun?.status !== "accepted") {
    return undefined;
  }
  const readiness = evaluateSunoTakeUrlReadiness(latestRun.urls, Date.parse(latestRun.createdAt), Date.now());
  if (!readiness.emit) {
    return undefined;
  }
  return deliverSunoTakeUrlReady(root, existing, baseState, song, latestRun, readiness);
}

async function deliverSunoTakeUrlReady(
  root: string,
  existing: AutopilotRunState,
  baseState: AutopilotRunState,
  song: SongState,
  latestRun: SunoRunRecord,
  readiness: SunoTakeUrlReadiness
): Promise<AutopilotRunState> {
  const collisions = await findTakeAttributionCollisions(root, song.songId, latestRun.urls);
  if (collisions.length > 0) {
    await appendTakeAttributionAudit(root, "take_attribution_collision_blocked", {
      songId: song.songId,
      runId: latestRun.runId,
      collisions
    });
    emitRuntimeEvent({
      type: "error",
      source: "take_attribution",
      reason: "take_attribution_collision_blocked",
      songId: song.songId,
      timestamp: Date.now()
    });
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: song.songId,
      paused: true,
      stage: "paused",
      blockedReason: "take_attribution_collision_blocked",
      lastError: "take_attribution_collision_blocked",
      lastSuccessfulStage: existing.lastSuccessfulStage,
      cycleCount: existing.cycleCount + 1
    });
  }
  const selectedTakeId = takeIdFromSunoUrl(readiness.urls[0]);
  await updateSongState(root, song.songId, {
    status: "suno_take_url_ready",
    reason: "Suno take URL ready; recovered stale generation lane",
    selectedTakeId,
    appendPublicLinks: latestRun.urls
  });
  emitRuntimeEvent({
    type: "suno_take_url_ready",
    songId: song.songId,
    runId: latestRun.runId,
    urls: readiness.urls,
    selectedTakeId,
    reason: readiness.fallback ? SINGLE_TAKE_URL_FALLBACK_REASON : undefined,
    timestamp: Date.now()
  });
  await markBuildingDraftDone(root, song.songId);
  return writeStageState(root, existing, {
    ...releaseAfterSunoTakeUrlReady(baseState),
    cycleCount: existing.cycleCount + 1
  });
}

// Songs at "suno_take_url_ready" are excluded from currentSong() selection, so once
// the lane advances to the next song their accepted Suno run would never be imported
// by the per-current-song stage machine. Sweep them each cycle and import by their
// own songId so pending takes always complete regardless of the current lane.
async function sweepPendingTakeImports(root: string, config: ArtistRuntimeConfig): Promise<void> {
  const songs = await listSongStates(root).catch(() => [] as SongState[]);
  for (const song of songs) {
    if (song.status !== "suno_take_url_ready") {
      continue;
    }
    const result = await importPendingSunoGeneration(root, song.songId, config).catch((error) => {
      emitRuntimeEvent({
        type: "error",
        source: "suno_pending_import_sweep",
        reason: error instanceof Error ? error.message : String(error),
        songId: song.songId,
        timestamp: Date.now()
      });
      return undefined;
    });
    if (result && !result.imported && result.reason) {
      emitRuntimeEvent({
        type: "error",
        source: "suno_pending_import_sweep",
        reason: result.reason,
        songId: song.songId,
        timestamp: Date.now()
      });
    }
  }
}

export async function readAutopilotRunState(root: string): Promise<AutopilotRunState> {
  return readAutopilotState(root);
}

export async function pauseAutopilot(root: string, reason = "paused by operator"): Promise<AutopilotRunState> {
  return new AutopilotControlService().pause(root, reason);
}

export async function resumeAutopilot(root: string): Promise<AutopilotRunState> {
  return new AutopilotControlService().resume(root);
}

function nextActionForStage(stage: AutopilotStage): string {
  switch (stage) {
    case "planning":
      return "decide_next_song";
    case "prompt_pack":
      return "create_or_validate_prompt_pack";
    case "suno_generation":
      return "create_or_wait_for_suno_run";
    case "take_selection":
      return "select_best_take";
    case "asset_generation":
      return "prepare_social_assets";
    case "publishing":
      return "publish_distribution_set";
    case "completed":
      return "idle";
    case "paused":
      return "await_manual_resume";
    case "failed_closed":
      return "surface_alert";
    default:
      return "idle";
  }
}

function nextActionForState(state: AutopilotRunState, stage: AutopilotStage): string {
  if (state.paused) {
    if (state.suspendedAt === PRODUCER_REVIEW_SUSPENDED_AT) {
      return "await_producer_review";
    }
    return "await_manual_resume";
  }
  return nextActionForStage(stage);
}

export function stageFromSong(song?: SongState): AutopilotStage {
  if (!song) {
    return "planning";
  }
  switch (song.status) {
    case "idea":
    case "brief":
    case "lyrics":
      return "prompt_pack";
    case "suno_prompt_pack":
    case "suno_running":
    case "suno_take_url_ready":
    case "takes_imported":
      return song.status === "takes_imported" ? "take_selection" : "suno_generation";
    case "take_selected":
      return "asset_generation";
    case "social_assets":
    case "publishing":
      return "publishing";
    case "published":
      return "completed";
    case "archived":
    case "discarded":
    case "failed":
      return "failed_closed";
    default:
      return "planning";
  }
}

async function currentSong(root: string, preferredSongId?: string): Promise<SongState | undefined> {
  const songs = await listSongStates(root);
  const preferred = preferredSongId ? songs.find((song) => song.songId === preferredSongId) : undefined;
  if (preferred && !["scheduled", "published", "archived", "discarded", "failed", "suno_take_url_ready"].includes(preferred.status)) {
    return preferred;
  }
  return songs.find((song) => !["scheduled", "published", "archived", "discarded", "failed", "take_selected", "suno_take_url_ready"].includes(song.status));
}

async function ensureLyrics(root: string, song: SongState, config?: Partial<ArtistRuntimeConfig>): Promise<SongState> {
  if (song.status === "lyrics" || song.status === "suno_prompt_pack" || song.status === "suno_running" || song.status === "suno_take_url_ready" || song.status === "takes_imported" || song.status === "take_selected" || song.status === "social_assets" || song.status === "published") {
    return song;
  }
  await draftLyrics({
    workspaceRoot: root,
    songId: song.songId,
    config,
    aiReviewProvider: config?.aiReview?.provider
  });
  return readSongState(root, song.songId);
}

async function createPromptPackForSong(root: string, song: SongState, config?: Partial<ArtistRuntimeConfig>, weirdnessOverride?: number): Promise<SongState> {
  const readySong = await ensureLyrics(root, song, config);
  const lyricsVersion = readySong.lyricsVersion ?? 1;
  const lyricsPath = join(root, "songs", readySong.songId, "lyrics", `lyrics.v${lyricsVersion}.md`);
  const [lyricsText, briefText, moodHint] = await Promise.all([
    readFile(lyricsPath, "utf8").catch(() => ""),
    readFile(join(root, "songs", readySong.songId, "brief.md"), "utf8").catch(() => ""),
    readFile(join(root, "songs", readySong.songId, "mood-hint.txt"), "utf8").catch(() => "")
  ]);
  const dopagakiVariation = decideDopagakiVariation({
    songId: readySong.songId,
    date: readySong.createdAt,
    briefText
  });
  const observationPath = briefText.match(/^- Path:\s*(.+)$/m)?.[1]?.trim();
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId: readySong.songId,
    songTitle: readySong.title,
    artistReason: readySong.lastReason ?? "autopilot prompt pack",
    lyricsText: lyricsText || briefText || readySong.title,
    knowledgePackVersion: "local-dev",
    configSnapshot: config,
    moodHint: appendDopagakiMoodHint(moodHint.trim() || undefined, dopagakiVariation),
    styleVariationSeed: dopagakiVariation.variationSeed,
    weirdnessOverride,
    observationPath: observationPath && observationPath !== "(runtime observation)" ? isAbsolute(observationPath) ? observationPath : join(root, observationPath) : undefined,
    aiReviewProvider: config?.aiReview?.provider
  });
  return readSongState(root, readySong.songId);
}

function firstLyricsExcerpt(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^```/.test(line))
    .slice(0, 5);
  return lines.join("\n") || "(歌詞 excerpt なし)";
}

async function promptPackReadySummary(root: string, song: SongState): Promise<{ lyricsExcerpt: string; mood: string; tempo: string; styleNotes: string }> {
  const lyricsVersion = song.lyricsVersion ?? 1;
  const [lyricsText, moodHint, styleText, briefText] = await Promise.all([
    readFile(join(root, "songs", song.songId, "lyrics", `lyrics.v${lyricsVersion}.md`), "utf8").catch(() => ""),
    readFile(join(root, "songs", song.songId, "mood-hint.txt"), "utf8").catch(() => ""),
    readFile(join(root, "songs", song.songId, "suno", "style.md"), "utf8").catch(() => ""),
    readFile(join(root, "songs", song.songId, "brief.md"), "utf8").catch(() => "")
  ]);
  const source = `${styleText}\n${briefText}`;
  const tempo = source.match(/\b\d{2,3}\s*BPM\b/i)?.[0] ?? "unspecified";
  const mood = moodHint.trim() || briefText.match(/^- Mood:\s*(.+)$/m)?.[1]?.trim() || "unspecified";
  const styleNotes = styleText.replace(/\s+/g, " ").trim().slice(0, 180) || briefText.match(/^- Style notes:\s*(.+)$/m)?.[1]?.trim() || "unspecified";
  return {
    lyricsExcerpt: firstLyricsExcerpt(lyricsText),
    mood,
    tempo,
    styleNotes
  };
}

async function writeCompletedStage(
  root: string,
  existing: AutopilotRunState,
  baseState: AutopilotRunState,
  songId?: string,
  blockedReason?: string | null
): Promise<AutopilotRunState> {
  try {
    if (songId) {
      await updateSongState(root, songId, { status: "published" });
    }
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: songId,
      stage: "completed",
      blockedReason,
      lastError: undefined,
      lastSuccessfulStage: "completed",
      retryCount: 0,
      cycleCount: existing.cycleCount + 1
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitRuntimeEvent({ type: "error", source: "song_completion", reason: message, songId, timestamp: Date.now() });
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: songId,
      stage: "paused",
      paused: true,
      pausedReason: "song_completion_failed",
      blockedReason: `song_completion_failed: ${message}`,
      lastError: message,
      retryCount: existing.retryCount + 1,
      cycleCount: existing.cycleCount + 1
    });
  }
}

function planningStalled(existing: AutopilotRunState, timeoutDays: number): boolean {
  const anchor = existing.lastRunAt ?? existing.updatedAt;
  if (!anchor) {
    return false;
  }
  return Date.now() - new Date(anchor).getTime() >= timeoutDays * 24 * 60 * 60 * 1000;
}

async function handlePlanningStage(
  root: string,
  song: SongState,
  existing: AutopilotRunState,
  baseState: AutopilotRunState,
  config: ArtistRuntimeConfig
): Promise<AutopilotRunState | undefined> {
  if (planningStalled(existing, config.autopilot.planningTimeoutDays)) {
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: song.songId,
      stage: "paused",
      paused: true,
      pausedReason: `planning_stalled_${config.autopilot.planningTimeoutDays}days`,
      blockedReason: `planning_stalled_${config.autopilot.planningTimeoutDays}days`,
      lastError: undefined,
      cycleCount: existing.cycleCount + 1
    });
  }
  const validation = await validatePlanningFiles(root, song.songId, {
    aiReviewProvider: config.aiReview.provider
  });
  if (validation.complete) {
    if (existing.suspendedAt === "planning_skeleton_pending") {
      return writeStageState(root, existing, {
        ...baseState,
        currentSongId: song.songId,
        stage: existing.stage,
        suspendedAt: null,
        blockedReason: undefined,
        lastError: undefined,
        cycleCount: existing.cycleCount
      });
    }
    return undefined;
  }
  if (validation.briefAbsent) {
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: undefined,
      stage: "planning",
      suspendedAt: null,
      blockedReason: undefined,
      lastError: `song_dir_missing:${song.songId}`,
      cycleCount: existing.cycleCount + 1
    });
  }
  if (!validation.proposal) {
    return undefined;
  }
  if (config.telegram.enabled && isPreGenerationApprovalEnabled()) {
    if (existing.suspendedAt !== "planning_skeleton_pending") {
      emitRuntimeEvent({
        type: "planning_skeleton_incomplete",
        songId: song.songId,
        missing: validation.missing,
        proposal: validation.proposal,
        timestamp: Date.now()
      });
    }
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: song.songId,
      stage: "planning",
      suspendedAt: "planning_skeleton_pending",
      blockedReason: `planning_skeleton_incomplete:${validation.missing.join(",")}`,
      lastError: undefined,
      cycleCount: existing.cycleCount + 1
    });
  }
  await applyChangeSet(root, validation.proposal);
  return undefined;
}

async function handleSunoGenerateFailure(
  root: string,
  existing: AutopilotRunState,
  baseState: AutopilotRunState,
  song: SongState,
  reason: string
): Promise<AutopilotRunState> {
  const retryCount = existing.retryCount + 1;
  const degraded = isDegradedLyricsBoxReason(reason);
  emitRuntimeEvent({
    type: "suno_create_failed",
    songId: song.songId,
    reason,
    retryCount,
    timestamp: Date.now()
  });
  if (degraded && retryCount < SUNO_LYRICS_BOX_DEGRADED_MAX_ATTEMPTS) {
    // Transient Suno UI degradation: stay un-paused and self-heal on later ticks. The
    // payload is valid for the real box; only Suno's momentary 1250 cap blocked it.
    emitRuntimeEvent({
      type: "suno_generate_retry",
      songId: song.songId,
      reason,
      retryCount,
      timestamp: Date.now()
    });
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: song.songId,
      stage: "suno_generation",
      paused: false,
      blockedReason: `suno_generate_retry:${reason}`,
      lastError: reason,
      lastRunAt: new Date().toISOString(),
      retryCount,
      cycleCount: existing.cycleCount + 1
    });
  }
  if (degraded) {
    // Self-heal window exhausted: surface to the producer so the operator can intervene.
    emitRuntimeEvent({
      type: "suno_generate_failed",
      songId: song.songId,
      reason,
      retryCount,
      timestamp: Date.now()
    });
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: song.songId,
      stage: "paused",
      paused: true,
      pausedReason: `suno_lyrics_box_degraded_unrecovered:${reason}`,
      blockedReason: `suno_lyrics_box_degraded_unrecovered:${reason}`,
      lastError: reason,
      retryCount,
      cycleCount: existing.cycleCount + 1
    });
  }
  if (retryCount >= 3) {
    emitRuntimeEvent({
      type: "suno_generate_failed",
      songId: song.songId,
      reason,
      retryCount,
      timestamp: Date.now()
    });
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: song.songId,
      stage: "paused",
      paused: true,
      pausedReason: `suno_generate_failed:${reason}`,
      blockedReason: `suno_generate_failed:${reason}`,
      lastError: reason,
      retryCount,
      cycleCount: existing.cycleCount + 1
    });
  }
  emitRuntimeEvent({
    type: "suno_generate_retry",
    songId: song.songId,
    reason,
    retryCount,
    timestamp: Date.now()
  });
  return writeStageState(root, existing, {
    ...baseState,
    currentSongId: song.songId,
    stage: "suno_generation",
    blockedReason: `suno_generate_retry:${reason}`,
    lastError: reason,
    retryCount,
    cycleCount: existing.cycleCount + 1
  });
}

async function choosePublishPlatform(config: ArtistRuntimeConfig): Promise<"x" | "instagram" | "tiktok"> {
  if (config.distribution.platforms.x.enabled) {
    return "x";
  }
  if (config.distribution.platforms.instagram.enabled) {
    return "instagram";
  }
  if (config.distribution.platforms.tiktok.enabled) {
    return "tiktok";
  }
  return "x";
}

export class ArtistAutopilotService {
  planNextStage(input: AutopilotTickInput): AutopilotStage {
    if (!input.enabled) {
      return "idle";
    }
    if (input.paused) {
      return "paused";
    }
    if (input.hardStop) {
      return "failed_closed";
    }
    if (!input.promptPackReady) {
      return "prompt_pack";
    }
    if (!input.takeSelected) {
      return "take_selection";
    }
    if (!input.assetsReady) {
      return "asset_generation";
    }
    return "publishing";
  }

  async runCycle(input: RunAutopilotCycleInput): Promise<AutopilotRunState> {
    await cleanupExpiredCallbacks(input.workspaceRoot).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[artist-runtime] callback ledger cleanup failed: ${reason}`);
    });
    const resolvedConfig = applyRuntimeEnvOverrides(applyConfigDefaults(input.config));
    const config = input.manualSeed
      ? { ...resolvedConfig, autopilot: { ...resolvedConfig.autopilot, enabled: true } }
      : resolvedConfig;
    const artistMind = await readArtistMind(input.workspaceRoot);
    const newsObservation = await collectNewsObservations(input.workspaceRoot, {
      personaText: `${artistMind.artist}\n${artistMind.socialVoice}`,
      config
    }).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      emitRuntimeEvent({ type: "error", source: "news_observation", reason, timestamp: Date.now() });
      return { status: "skipped" as const, path: "", entries: [], reason };
    });
    const personaText = `${artistMind.artist}\n${artistMind.socialVoice}`;
    const reactionQuery = input.manualSeed ? { queries: [] } : buildNewsReactionQueries(newsObservation.entries, { personaText });
    const cycleObservation = await collectObservations(input.workspaceRoot, {
      personaText,
      queries: input.manualSeed?.hint ? undefined : reactionQuery.queries.length > 0 ? reactionQuery.queries : ["music OR society OR culture"],
      reactionSeed: reactionQuery.seed,
      manualSeed: input.manualSeed,
      runner: input.observationRunner
    }).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      emitRuntimeEvent({ type: "error", source: "x_observation", reason, timestamp: Date.now() });
      return { status: "skipped" as const, path: join(input.workspaceRoot, "observations"), observations: "", reason };
    });
    if (cycleObservation.status === "cooldown") {
      emitRuntimeEvent({
        type: "bird_cooldown_triggered",
        reason: cycleObservation.reason ?? "bird cool-down active",
        cooldownUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        timestamp: Date.now()
      });
    }
    if (isArtistPulseConfigured(config)) {
      await shouldPulse(input.workspaceRoot, { minIntervalHours: getArtistPulseIntervalHours(process.env, config) }).then(async (allowed) => {
        if (!allowed) {
          return;
        }
        const draft = await composeDailyVoice(input.workspaceRoot, { aiReviewProvider: config.aiReview.provider });
        emitRuntimeEvent({
          type: "artist_pulse_drafted",
          ...draft,
          timestamp: Date.now()
        });
        await markPulsed(input.workspaceRoot, new Date(draft.createdAt));
      }).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[artist-runtime] artist pulse failed: ${reason}`);
      });
    }
    const existing = await readAutopilotRunState(input.workspaceRoot);
    const currentLaneSong = await currentSong(input.workspaceRoot, existing.currentSongId);
    if (
      currentLaneSong
      && (
        existing.suspendedAt === PRODUCER_REVIEW_SUSPENDED_AT
        || currentLaneSong.status === "take_selected"
      )
    ) {
      return writeStageState(input.workspaceRoot, existing, {
        ...releaseAfterTakeCompletion({
          ...existing,
          currentSongId: currentLaneSong.songId,
          stage: "take_selection",
          lastRunAt: nowIso()
        }),
        cycleCount: existing.cycleCount + 1
      });
    }
    if (!input.manualSeed && isSongSpawnConfigured(config)) {
      const pendingSong = currentLaneSong;
      if (
        pendingSong
        && isPrePromptSongWithoutApprovalGate(pendingSong)
        && !await hasProducerSpawnApproval(input.workspaceRoot, pendingSong.songId)
        && isPreGenerationApprovalEnabled()
      ) {
        const pendingRunId = existing.runId ?? `auto_${Date.now().toString(36)}`;
        return suspendForProducerSpawnApproval(input.workspaceRoot, existing, pendingSong, {
          ...existing,
          runId: pendingRunId,
          currentSongId: pendingSong.songId,
          stage: stageFromSong(pendingSong),
          lastRunAt: nowIso()
        });
      }
    }
    if (isSongSpawnConfigured(config)) {
      const producerReviewOnly = isProducerReviewOnlyLane(existing);
      const ideaLane = await runIdeaQueueLane(input.workspaceRoot, existing, config, {
        preserveCurrentSongLane: producerReviewOnly
      });
      if (producerReviewOnly) {
        return ideaLane.state ?? writeStageState(input.workspaceRoot, existing, {
          ...existing,
          stage: "paused",
          blockedReason: existing.pausedReason ?? existing.blockedReason ?? PRODUCER_REVIEW_SUSPENDED_AT,
          lastRunAt: nowIso()
        });
      }
      const afterSpawn = await readAutopilotRunState(input.workspaceRoot);
      if (!afterSpawn.currentSongId && afterSpawn.suspendedAt === "spawn_proposal_ready") {
        return afterSpawn;
      }
    }
    if (!config.autopilot.enabled) {
      return writeStageState(input.workspaceRoot, existing, {
        ...existing,
        stage: "idle",
        blockedReason: "autopilot disabled by config",
        lastRunAt: nowIso()
      });
    }
    if (existing.paused) {
      return writeStageState(input.workspaceRoot, existing, {
        ...existing,
        stage: "paused",
        blockedReason: existing.pausedReason ?? "paused by operator",
        lastRunAt: nowIso()
      });
    }
    if (existing.hardStopReason) {
      return writeStageState(input.workspaceRoot, existing, {
        ...existing,
        stage: "failed_closed",
        blockedReason: existing.hardStopReason,
        lastRunAt: nowIso()
      });
    }
    await runStaleQueueMaintenance(input.workspaceRoot, {
      ttlHours: getStaleQueueCleanupHours(process.env)
    }).then((result) => {
      for (const entry of result.cleaned) {
        emitRuntimeEvent({
          type: "error",
          source: "stale_queue_cleanup",
          reason: entry.reason,
          songId: entry.songId,
          timestamp: Date.now()
        });
      }
      for (const issue of result.inconsistencies) {
        const reason = `${issue.reason}:${issue.callbackId}:${issue.songId}`;
        console.warn(`[artist-runtime] ${reason}`);
        emitRuntimeEvent({
          type: "error",
          source: "callback_ledger_consistency",
          reason,
          songId: issue.songId,
          timestamp: Date.now()
        });
      }
    }).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[artist-runtime] stale queue maintenance failed: ${reason}`);
    });
    await pollSongDistribution(input.workspaceRoot).catch((error) => {
      emitRuntimeEvent({
        type: "error",
        source: "distribution_polling",
        reason: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      });
    });
    if (isSongbookAutoSyncEnabled()) {
      await syncSongbookFromITunes(input.workspaceRoot).catch((error) => {
        emitRuntimeEvent({
          type: "error",
          source: "songbook_sync",
          reason: error instanceof Error ? error.message : String(error),
          timestamp: Date.now()
        });
      });
    }

    await sweepPendingTakeImports(input.workspaceRoot, config);

    const song = await currentSong(input.workspaceRoot, existing.currentSongId);
    const suppressedRestartStaleError = await suppressRestartStaleError(
      input.workspaceRoot,
      existing.currentSongId,
      song,
      existing.blockedReason,
      existing.lastError
    );
    const stateBeforeStage = suppressedRestartStaleError
      ? { ...existing, blockedReason: undefined, lastError: undefined, retryCount: 0 }
      : existing;
    if (suppressedRestartStaleError) {
      console.warn(`[artist-runtime] ${suppressedRestartStaleError}`);
      emitRuntimeEvent({
        type: "error",
        source: "autopilot_restart_stale_error",
        reason: suppressedRestartStaleError,
        songId: existing.currentSongId,
        timestamp: Date.now()
      });
    }
    const stage = stageFromSong(song);
    const runId = !song && existing.lastSuccessfulStage === "completed"
      ? `auto_${Date.now().toString(36)}`
      : stateBeforeStage.runId ?? `auto_${Date.now().toString(36)}`;
    const baseState: AutopilotRunState = {
      ...stateBeforeStage,
      runId,
      currentSongId: song?.songId,
      stage,
      suspendedAt: stateBeforeStage.suspendedAt === "prompt_pack_ready" && !isPreGenerationApprovalEnabled() ? undefined : stateBeforeStage.suspendedAt,
      blockedReason: stateBeforeStage.suspendedAt === "prompt_pack_ready" && !isPreGenerationApprovalEnabled() ? undefined : stateBeforeStage.blockedReason,
      lastRunAt: nowIso()
    };

    if (song && song.status === "take_selected") {
      return writeStageState(input.workspaceRoot, existing, {
        ...releaseAfterTakeCompletion(baseState),
        cycleCount: existing.cycleCount + 1
      });
    }

    if (
      !input.manualSeed
      && song
      && isSongSpawnConfigured(config)
      && isPrePromptSongWithoutApprovalGate(song)
      && !await hasProducerSpawnApproval(input.workspaceRoot, song.songId)
      && isPreGenerationApprovalEnabled()
    ) {
      return suspendForProducerSpawnApproval(input.workspaceRoot, existing, song, baseState);
    }

    if (
      song
      && (existing.suspendedAt === "prompt_pack_ready" || existing.suspendedAt === "user_paused")
      && !(existing.suspendedAt === "prompt_pack_ready" && !isPreGenerationApprovalEnabled())
      && !(existing.suspendedAt === "prompt_pack_ready" && await isBuildingDraftSong(input.workspaceRoot, song.songId))
    ) {
      return writeStageState(input.workspaceRoot, existing, {
        ...baseState,
        currentSongId: song.songId,
        stage: "prompt_pack",
        blockedReason: existing.suspendedAt,
        lastError: undefined,
        lastSuccessfulStage: existing.lastSuccessfulStage
      });
    }

    if (song && existing.stage === "planning") {
      const planningResult = await handlePlanningStage(input.workspaceRoot, song, existing, baseState, config);
      if (planningResult) {
        return planningResult;
      }
    }

    if (
      !song
      && existing.lastSuccessfulStage === "publishing"
      && config.autopilot.dryRun
      && existing.blockedReason?.includes("dry-run")
    ) {
      return writeCompletedStage(input.workspaceRoot, existing, baseState, existing.currentSongId, existing.blockedReason);
    }

    if (
      song
      && stage === "publishing"
      && existing.lastSuccessfulStage === "publishing"
      && config.autopilot.dryRun
      && existing.blockedReason?.includes("dry-run")
    ) {
      return writeCompletedStage(input.workspaceRoot, existing, baseState, song.songId, existing.blockedReason);
    }

    const hasUnresolvedBlock = Boolean(stateBeforeStage.blockedReason || stateBeforeStage.lastError);
    if (
      existing.runId === runId
      && existing.lastSuccessfulStage === stage
      && stage !== "planning"
      && !hasUnresolvedBlock
    ) {
      return writeStageState(input.workspaceRoot, existing, baseState);
    }

    try {
      if (!song) {
        if (!input.manualSeed) {
          const weeklyLimit = await weeklySongLimitBlocked(input.workspaceRoot, config);
          if (weeklyLimit) {
            return writeStageState(input.workspaceRoot, existing, {
              ...baseState,
              currentSongId: undefined,
              stage: "planning",
              blockedReason: weeklyLimit,
              lastError: undefined,
              cycleCount: existing.cycleCount + 1
            });
          }
        }
        if (!input.manualSeed && isSongSpawnConfigured(config)) {
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            currentSongId: undefined,
            stage: "planning",
            blockedReason: "song_spawn_waiting_for_proposal",
            lastError: undefined,
            cycleCount: existing.cycleCount + 1
          });
        }
        const theme = await proposeTheme(input.workspaceRoot, {
          observations: cycleObservation.observations,
          aiReviewProvider: config.aiReview.provider
        });
        emitRuntimeEvent({
          type: "theme_generated",
          theme: theme.theme,
          reason: theme.reason,
          timestamp: Date.now()
        });
        const idea = await createSongIdea({
          workspaceRoot: input.workspaceRoot,
          config,
          theme: theme.theme,
          artistReason: input.manualSeed?.hint ? `${theme.reason}; producer hint: ${input.manualSeed.hint}` : theme.reason,
          observationText: cycleObservation.observations,
          observationPath: cycleObservation.path
        });
        return writeStageState(input.workspaceRoot, existing, {
          ...baseState,
          currentSongId: idea.songId,
          stage: "planning",
          blockedReason: undefined,
          lastError: undefined,
          lastSuccessfulStage: "planning",
          cycleCount: existing.cycleCount + 1
        });
      }

      switch (stage) {
        case "prompt_pack": {
          let packedSong: SongState;
          try {
            packedSong = await createPromptPackForSong(input.workspaceRoot, song, config, input.manualSeed?.weirdness);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (reason.includes("lyrics_generation_degraded")) {
              return writeStageState(input.workspaceRoot, existing, {
                ...baseState,
                currentSongId: song.songId,
                stage: "paused",
                paused: true,
                pausedReason: reason,
                blockedReason: reason,
                lastError: reason,
                cycleCount: existing.cycleCount + 1
              });
            }
            throw error;
          }
          const draftBoxOneShot = await isBuildingDraftSong(input.workspaceRoot, packedSong.songId);
          const promptReadySuspension = config.telegram.enabled && isPreGenerationApprovalEnabled() && !draftBoxOneShot;
          if (promptReadySuspension) {
            const [summary, voiceTop] = await Promise.all([
              promptPackReadySummary(input.workspaceRoot, packedSong),
              composeVoiceTopOnly("propose", input.workspaceRoot, undefined, [], { runId: packedSong.songId }).catch(() => undefined)
            ]);
            emitRuntimeEvent({
              type: "prompt_pack_ready",
              songId: packedSong.songId,
              title: packedSong.title,
              lyricsExcerpt: summary.lyricsExcerpt,
              mood: summary.mood,
              tempo: summary.tempo,
              styleNotes: summary.styleNotes,
              voiceTop,
              timestamp: Date.now()
            });
          }
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            currentSongId: packedSong.songId,
            stage: promptReadySuspension ? "prompt_pack" : "suno_generation",
            blockedReason: undefined,
            lastError: undefined,
            lastSuccessfulStage: "prompt_pack",
            suspendedAt: promptReadySuspension ? "prompt_pack_ready" : undefined,
            cycleCount: existing.cycleCount + 1
          });
        }
        case "suno_generation": {
          const importBeforeUrlReadyRecovery = song.status === "suno_running";
          if (importBeforeUrlReadyRecovery) {
            const pendingImport = await importPendingSunoGeneration(input.workspaceRoot, song.songId, config, existing);
            if (pendingImport?.imported) {
              return writeStageState(input.workspaceRoot, existing, {
                ...baseState,
                currentSongId: song.songId,
                stage: "take_selection",
                blockedReason: undefined,
                lastError: undefined,
                lastSuccessfulStage: "suno_generation",
                retryCount: 0,
                cycleCount: existing.cycleCount + 1
              });
            }
            if (pendingImport && !pendingImport.imported) {
              // Respect the audio import guards (dry-run isolation, take-attribution
              // collisions) before considering URL-ready delivery.
              if (pendingImport.pause) {
                return writeStageState(input.workspaceRoot, existing, {
                  ...baseState,
                  currentSongId: song.songId,
                  paused: true,
                  stage: "paused",
                  blockedReason: pendingImport.reason,
                  lastError: pendingImport.reason,
                  lastSuccessfulStage: existing.lastSuccessfulStage,
                  cycleCount: existing.cycleCount + 1
                });
              }
              // Audio isn't ready yet. If the run captured only one of its two take URLs,
              // hold (or bounded-fallback deliver) it instead of wedging on "waiting for
              // Suno result import" so the single URL still reaches the producer.
              const singleTakeUrlHold = await holdSingleSunoTakeUrl(input.workspaceRoot, existing, baseState, song);
              if (singleTakeUrlHold) {
                return singleTakeUrlHold;
              }
              return writeStageState(input.workspaceRoot, existing, {
                ...baseState,
                currentSongId: song.songId,
                stage: "suno_generation",
                blockedReason: pendingImport.reason,
                lastError: pendingImport.reason,
                lastSuccessfulStage: existing.lastSuccessfulStage,
                cycleCount: existing.cycleCount + 1
              });
            }
          } else {
            // Non-suno_running lanes (e.g. a stale prompt-pack whose run already captured a
            // single take URL) must hold instead of regenerating and burning a new credit.
            const singleTakeUrlHold = await holdSingleSunoTakeUrl(input.workspaceRoot, existing, baseState, song);
            if (singleTakeUrlHold) {
              return singleTakeUrlHold;
            }
          }
          const recoveredUrlReady = await recoverAcceptedRunUrlReady(input.workspaceRoot, existing, baseState, song);
          if (recoveredUrlReady) {
            return recoveredUrlReady;
          }
          const generationLimit = await evaluateSunoGenerationLimits(input.workspaceRoot, config);
          if (generationLimit) {
            return writeStageState(input.workspaceRoot, existing, {
              ...baseState,
              currentSongId: song.songId,
              stage: "suno_generation",
              blockedReason: generationLimit.reason,
              lastError: generationLimit.reason,
              lastSuccessfulStage: existing.lastSuccessfulStage,
              cycleCount: existing.cycleCount + 1
            });
          }
          if (isMockSunoGenerationBypass(config)) {
            await importMockSunoGeneration(input.workspaceRoot, song.songId, existing, config);
            return writeStageState(input.workspaceRoot, existing, {
              ...baseState,
              currentSongId: song.songId,
              stage: "take_selection",
              blockedReason: undefined,
              lastError: undefined,
              lastSuccessfulStage: "suno_generation",
              retryCount: 0,
              cycleCount: existing.cycleCount + 1
            });
          }
          if (isDegradedLyricsBoxReason(existing.blockedReason)) {
            // Transient degraded box: skip the generic exponential backoff and re-attempt
            // the create this tick; only pause once the self-heal window is exhausted.
            if (existing.retryCount >= SUNO_LYRICS_BOX_DEGRADED_MAX_ATTEMPTS) {
              return handleSunoGenerateFailure(
                input.workspaceRoot,
                existing,
                baseState,
                song,
                existing.lastError ?? `${SUNO_LYRICS_BOX_DEGRADED_MARKER}:cap_reached`
              );
            }
          }
          if (!isDegradedLyricsBoxReason(existing.blockedReason)) {
            const retryDecision = nextSunoRetryDecision(existing);
            if (retryDecision.action === "wait") {
              if (shouldEmitOperationalEpisode(existing, retryDecision.reason)) {
                emitRuntimeEvent({
                  type: "suno_generate_retry",
                  songId: song.songId,
                  reason: retryDecision.reason,
                  retryCount: existing.retryCount,
                  nextRetryAt: retryDecision.nextRetryAt,
                  timestamp: Date.now()
                });
              }
              return writeStageState(input.workspaceRoot, existing, {
                ...baseState,
                currentSongId: song.songId,
                stage: "suno_generation",
                lastRunAt: existing.lastRunAt,
                blockedReason: retryDecision.reason,
                lastError: undefined,
                lastSuccessfulStage: existing.lastSuccessfulStage,
                cycleCount: existing.cycleCount + 1
              });
            }
            if (retryDecision.action === "failed") {
              return handleSunoGenerateFailure(input.workspaceRoot, existing, baseState, song, retryDecision.reason);
            }
          }
          let generateError: unknown;
          const run = await generateSunoRun({ workspaceRoot: input.workspaceRoot, songId: song.songId, config }).catch((error) => {
            generateError = error;
            return undefined;
          });
          if (!run) {
            return handleSunoGenerateFailure(input.workspaceRoot, existing, baseState, song, classifySunoGenerateFailure(generateError));
          }
          if (run.status === "failed" || run.status === "blocked_authority") {
            return handleSunoGenerateFailure(input.workspaceRoot, existing, baseState, song, run.error?.message ?? run.authorityDecision.reason);
          }
          if (run.status === "accepted") {
            // Deliver only when BOTH take URLs are captured together. A single captured
            // URL is held (kept in suno_running via sunoRuns) so the next cycle re-checks
            // and fires once both are present, or falls back to the single URL after the
            // bounded window.
            const readiness = evaluateSunoTakeUrlReadiness(run.urls, Date.parse(run.createdAt), Date.now());
            if (readiness.emit) {
              const selectedTakeId = takeIdFromSunoUrl(readiness.urls[0]);
              emitRuntimeEvent({
                type: "suno_take_url_ready",
                songId: song.songId,
                runId: run.runId,
                urls: readiness.urls,
                selectedTakeId,
                reason: readiness.fallback ? SINGLE_TAKE_URL_FALLBACK_REASON : undefined,
                timestamp: Date.now()
              });
              await markBuildingDraftDone(input.workspaceRoot, song.songId);
              return writeStageState(input.workspaceRoot, existing, {
                ...releaseAfterSunoTakeUrlReady(baseState),
                cycleCount: existing.cycleCount + 1
              });
            }
            if (readiness.urls.length > 0) {
              return writeStageState(input.workspaceRoot, existing, {
                ...baseState,
                currentSongId: song.songId,
                stage: "suno_generation",
                blockedReason: AWAITING_SECOND_SUNO_TAKE_URL_REASON,
                lastError: undefined,
                lastSuccessfulStage: "suno_generation",
                cycleCount: existing.cycleCount + 1
              });
            }
          }
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            currentSongId: song.songId,
            stage: "suno_generation",
            blockedReason: run.status === "accepted" || run.status === "blocked_dry_run" ? "waiting for Suno result import" : run.authorityDecision.reason,
            lastError: run.error?.message,
            lastSuccessfulStage: "suno_generation",
            retryCount: 0,
            cycleCount: existing.cycleCount + 1
          });
        }
        case "take_selection": {
          const decision = await evaluateSunoTakeSelection(input.workspaceRoot, song.songId);
          if (decision.status === "pending") {
            if (shouldEmitOperationalEpisode(existing, decision.reason)) {
              emitRuntimeEvent({
                type: "take_select_pending",
                songId: song.songId,
                reason: decision.reason,
                timestamp: Date.now()
              });
              emitRuntimeEvent({
                type: "take_selection_stalled",
                songId: song.songId,
                reason: decision.reason,
                timestamp: Date.now()
              });
            }
            return writeStageState(input.workspaceRoot, existing, {
              ...baseState,
              currentSongId: song.songId,
              stage: "take_selection",
              blockedReason: decision.reason,
              lastError: undefined,
              cycleCount: existing.cycleCount + 1
            });
          }
          const selection = await selectTake({ workspaceRoot: input.workspaceRoot, songId: song.songId });
          emitRuntimeEvent({
            type: "song_take_completed",
            songId: song.songId,
            selectedTakeId: selection.selectedTakeId,
            urls: selection.sourceUrls,
            timestamp: Date.now()
          });
          await markBuildingDraftDone(input.workspaceRoot, song.songId);
          return writeStageState(input.workspaceRoot, existing, {
            ...releaseAfterTakeCompletion(baseState),
            cycleCount: existing.cycleCount + 1
          });
        }
        case "asset_generation": {
          try {
            await prepareSocialAssets({ workspaceRoot: input.workspaceRoot, songId: song.songId, config });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const blockedReason = `asset_generation_stalled:${reason}`;
            if (shouldEmitOperationalEpisode(existing, blockedReason)) {
              emitRuntimeEvent({
                type: "asset_generation_stalled",
                songId: song.songId,
                reason,
                timestamp: Date.now()
              });
            }
            return writeStageState(input.workspaceRoot, existing, {
              ...baseState,
              currentSongId: song.songId,
              stage: "asset_generation",
              blockedReason,
              lastError: reason,
              cycleCount: existing.cycleCount + 1
            });
          }
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            currentSongId: song.songId,
            stage: "asset_generation",
            blockedReason: undefined,
            lastError: undefined,
            lastSuccessfulStage: "asset_generation",
            cycleCount: existing.cycleCount + 1
          });
        }
        case "publishing": {
          const platform = await choosePublishPlatform(config);
          const assetPath = join(
            input.workspaceRoot,
            "songs",
            song.songId,
            "social",
            `${platform}-${platform === "x" ? "post" : "caption"}.md`
          );
          const text = await readFile(assetPath, "utf8").catch(() => song.title);
          const published = await publishSocialAction({
            workspaceRoot: input.workspaceRoot,
            songId: song.songId,
            platform,
            postType: platform === "x" ? "observation" : platform === "instagram" ? "lyric_card" : "hook_clip",
            text,
            config,
            action: "publish"
          });
          if (config.autopilot.dryRun && isPublishBlockedByDryRun(published.result, published.entry)) {
            await updateSongState(input.workspaceRoot, song.songId, {
              status: "published",
              reason: `dry-run publish simulated: ${published.result.reason}`
            });
          }
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            currentSongId: song.songId,
            stage: "publishing",
            blockedReason: published.result.accepted ? undefined : published.result.reason,
            lastError: published.result.accepted ? undefined : published.result.reason,
            lastSuccessfulStage: "publishing",
            cycleCount: existing.cycleCount + 1
          });
        }
        case "completed": {
          return writeCompletedStage(input.workspaceRoot, existing, baseState, song.songId);
        }
        case "failed_closed": {
          const reason = song.lastReason ?? "song marked failed";
          emitRuntimeEvent({
            type: "suno_hard_stop",
            songId: song.songId,
            reason,
            timestamp: Date.now()
          });
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            currentSongId: song.songId,
            stage: "failed_closed",
            hardStopReason: reason,
            blockedReason: reason
          });
        }
        default:
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            stage: "planning",
            blockedReason: undefined,
            lastError: undefined,
            lastSuccessfulStage: "planning",
            cycleCount: existing.cycleCount + 1
          });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitRuntimeEvent({
        type: "error",
        source: "autopilot",
        reason: message,
        songId: baseState.currentSongId,
        timestamp: Date.now()
      });
      emitRuntimeEvent({
        type: "suno_hard_stop",
        songId: baseState.currentSongId,
        reason: message,
        timestamp: Date.now()
      });
      return writeStageState(input.workspaceRoot, existing, {
        ...baseState,
        stage: "failed_closed",
        hardStopReason: message,
        blockedReason: message,
        lastError: message,
        retryCount: existing.retryCount + 1
      });
    }
  }

  async tick(input: AutopilotTickInput): Promise<AutopilotStatus> {
    return {
      enabled: input.enabled,
      dryRun: input.dryRun,
      stage: this.planNextStage(input),
      nextAction: nextActionForStage(this.planNextStage(input))
    };
  }

  async status(enabled = false, dryRun = true, workspaceRoot?: string): Promise<AutopilotStatus> {
    const state = workspaceRoot ? await readAutopilotRunState(workspaceRoot) : { ...defaultAutopilotRunState };
    const stage = enabled ? (state.paused ? "paused" : state.stage) : "idle";
    return {
      enabled,
      dryRun,
      stage,
      nextAction: enabled ? nextActionForState(state, stage) : nextActionForStage(stage),
      currentRunId: state.runId,
      currentSongId: state.currentSongId,
      suspendedAt: state.suspendedAt,
      lastSuccessfulStage: state.lastSuccessfulStage,
      pausedReason: state.pausedReason,
      hardStopReason: state.hardStopReason,
      blockedReason: state.blockedReason,
      lastError: state.lastError,
      retryCount: state.retryCount
    };
  }
}
