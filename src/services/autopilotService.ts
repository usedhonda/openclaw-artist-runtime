import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { applyConfigDefaults } from "../config/schema.js";
import { BrowserWorkerSunoConnector } from "../connectors/suno/browserWorkerConnector.js";
import type { AutopilotRunState, AutopilotStage, AutopilotStatus, ArtistRuntimeConfig, SocialPublishLedgerEntry, SocialPublishResult, SongState } from "../types.js";
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
import { generateSunoRun, importSunoResults, readLatestSunoRun } from "./sunoRuns.js";
import { publishSocialAction } from "./socialPublishing.js";
import { selectTake } from "./takeSelection.js";
import { evaluateSunoTakeSelection } from "./sunoTakeSelector.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { resetIfNewDay } from "./sunoBudgetLedger.js";
import { reserveSunoGenerationBudget } from "./sunoBudgetGuard.js";
import { classifySunoGenerateFailure, nextSunoRetryDecision } from "./sunoRetryHandler.js";
import { collectObservations, type XObservationContext } from "./xObservationCollector.js";
import { proposeTheme } from "./themeProposer.js";
import { pollSongDistribution } from "./songDistributionPoller.js";
import { cleanupExpiredCallbacks } from "./callbackLedgerMaintenance.js";
import { applyRuntimeEnvOverrides, getArtistPulseIntervalHours, getSongSpawnIntervalHours, isArtistPulseConfigured, isSongbookAutoSyncEnabled, isSongSpawnConfigured } from "./runtimeConfig.js";
import { proposeSpawn } from "./songSpawnProposer.js";
import { shouldSpawn } from "./songSpawnRateLimiter.js";
import { validatePlanningFiles } from "./planningSkeletonValidator.js";
import { applyChangeSet } from "./changeSetApplier.js";
import { syncSongbookFromITunes } from "./songbookSyncer.js";
import { composeVoiceTopOnly } from "./commandVoiceWrapper.js";

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
  manualSeed?: { hint: string };
  observationRunner?: XObservationContext["runner"];
}

function nowIso(): string {
  return new Date().toISOString();
}

function writeStageState(root: string, previous: AutopilotRunState, next: AutopilotRunState): Promise<AutopilotRunState> {
  if (previous.stage !== next.stage || previous.currentSongId !== next.currentSongId) {
    emitRuntimeEvent({
      type: "autopilot_stage_changed",
      songId: next.currentSongId,
      from: previous.stage,
      to: next.stage,
      timestamp: Date.now()
    });
  }
  return writeAutopilotRunState(root, next);
}

export async function writeAutopilotRunState(root: string, state: AutopilotRunState): Promise<AutopilotRunState> {
  return writeAutopilotState(root, state);
}

async function importPendingSunoGeneration(
  root: string,
  songId: string,
  config: ArtistRuntimeConfig
): Promise<{ imported: true } | { imported: false; reason?: string } | undefined> {
  const connector = new BrowserWorkerSunoConnector(root, { config });
  const workerStatus = await connector.status().catch(() => undefined);
  if (workerStatus?.state !== "generating") {
    return undefined;
  }

  const latestRun = await readLatestSunoRun(root, songId);
  const runId = workerStatus.currentRunId ?? latestRun?.runId;
  if (!runId) {
    return { imported: false, reason: "suno_import_missing_run_id" };
  }

  const result = await connector.importResults({ runId, urls: [] });
  if (result.urls.length === 0) {
    return { imported: false, reason: result.reason ?? "waiting for Suno result import" };
  }

  await importSunoResults({
    workspaceRoot: root,
    songId,
    runId: result.runId ?? runId,
    urls: result.urls,
    selectedTakeId: result.selectedTakeId,
    resultRefs: result.paths ?? [],
    config
  });
  return { imported: true };
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

function stageFromSong(song?: SongState): AutopilotStage {
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
    case "takes_imported":
      return song.status === "takes_imported" ? "take_selection" : "suno_generation";
    case "take_selected":
      return "asset_generation";
    case "social_assets":
      return "publishing";
    case "published":
      return "completed";
    case "archived":
    case "failed":
      return "failed_closed";
    default:
      return "planning";
  }
}

async function currentSong(root: string, preferredSongId?: string): Promise<SongState | undefined> {
  const songs = await listSongStates(root);
  const preferred = preferredSongId ? songs.find((song) => song.songId === preferredSongId) : undefined;
  if (preferred && !["scheduled", "published", "archived", "failed"].includes(preferred.status)) {
    return preferred;
  }
  return songs.find((song) => song.status !== "scheduled" && song.status !== "published" && song.status !== "archived" && song.status !== "failed");
}

async function ensureLyrics(root: string, song: SongState, config?: Partial<ArtistRuntimeConfig>): Promise<SongState> {
  if (song.status === "lyrics" || song.status === "suno_prompt_pack" || song.status === "suno_running" || song.status === "takes_imported" || song.status === "take_selected" || song.status === "social_assets" || song.status === "published") {
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

async function createPromptPackForSong(root: string, song: SongState, config?: Partial<ArtistRuntimeConfig>): Promise<SongState> {
  const readySong = await ensureLyrics(root, song, config);
  const lyricsVersion = readySong.lyricsVersion ?? 1;
  const lyricsPath = join(root, "songs", readySong.songId, "lyrics", `lyrics.v${lyricsVersion}.md`);
  const [lyricsText, briefText, moodHint] = await Promise.all([
    readFile(lyricsPath, "utf8").catch(() => ""),
    readFile(join(root, "songs", readySong.songId, "brief.md"), "utf8").catch(() => ""),
    readFile(join(root, "songs", readySong.songId, "mood-hint.txt"), "utf8").catch(() => "")
  ]);
  const observationPath = briefText.match(/^- Path:\s*(.+)$/m)?.[1]?.trim();
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId: readySong.songId,
    songTitle: readySong.title,
    artistReason: readySong.lastReason ?? "autopilot prompt pack",
    lyricsText: lyricsText || briefText || readySong.title,
    knowledgePackVersion: "local-dev",
    configSnapshot: config,
    moodHint: moodHint.trim() || undefined,
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
    return undefined;
  }
  if (!validation.proposal) {
    return undefined;
  }
  if (config.telegram.enabled) {
    emitRuntimeEvent({
      type: "planning_skeleton_incomplete",
      songId: song.songId,
      missing: validation.missing,
      proposal: validation.proposal,
      timestamp: Date.now()
    });
    return writeStageState(root, existing, {
      ...baseState,
      currentSongId: song.songId,
      stage: "planning",
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
    const cycleObservation = await collectObservations(input.workspaceRoot, {
      personaText: `${artistMind.artist}\n${artistMind.socialVoice}`,
      query: input.manualSeed?.hint ? undefined : "music OR society OR culture",
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
    if (isSongSpawnConfigured(config)) {
      await shouldSpawn(input.workspaceRoot, { minIntervalHours: getSongSpawnIntervalHours(process.env, config) }).then(async (allowed) => {
        if (!allowed) {
          return;
        }
        const proposal = await proposeSpawn(input.workspaceRoot, {
          aiReviewProvider: config.aiReview.provider
        });
        if (!proposal) {
          return;
        }
        const voiceTop = await composeVoiceTopOnly("propose", input.workspaceRoot).catch(() => undefined);
        emitRuntimeEvent({
          type: "song_spawn_proposed",
          brief: proposal.brief,
          reason: proposal.reason,
          candidateSongId: proposal.candidateSongId,
          voiceTop,
          timestamp: Date.now()
        });
      }).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[artist-runtime] song spawn proposal failed: ${reason}`);
      });
    }
    const existing = await readAutopilotRunState(input.workspaceRoot);
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
    await resetIfNewDay(input.workspaceRoot);
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

    const song = await currentSong(input.workspaceRoot, existing.currentSongId);
    const stage = stageFromSong(song);
    const runId = !song && existing.lastSuccessfulStage === "completed"
      ? `auto_${Date.now().toString(36)}`
      : existing.runId ?? `auto_${Date.now().toString(36)}`;
    const baseState: AutopilotRunState = {
      ...existing,
      runId,
      currentSongId: song?.songId,
      stage,
      lastRunAt: nowIso()
    };

    if (song && (existing.suspendedAt === "prompt_pack_ready" || existing.suspendedAt === "user_paused")) {
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

    const hasUnresolvedBlock = Boolean(existing.blockedReason || existing.lastError);
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
            packedSong = await createPromptPackForSong(input.workspaceRoot, song, config);
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
          const promptReadySuspension = config.telegram.enabled;
          if (promptReadySuspension) {
            const [summary, voiceTop] = await Promise.all([
              promptPackReadySummary(input.workspaceRoot, packedSong),
              composeVoiceTopOnly("propose", input.workspaceRoot).catch(() => undefined)
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
            stage: "prompt_pack",
            blockedReason: undefined,
            lastError: undefined,
            lastSuccessfulStage: "prompt_pack",
            suspendedAt: promptReadySuspension ? "prompt_pack_ready" : undefined,
            cycleCount: existing.cycleCount + 1
          });
        }
        case "suno_generation": {
          const retryDecision = nextSunoRetryDecision(existing);
          if (retryDecision.action === "wait") {
            emitRuntimeEvent({
              type: "suno_generate_retry",
              songId: song.songId,
              reason: retryDecision.reason,
              retryCount: existing.retryCount,
              nextRetryAt: retryDecision.nextRetryAt,
              timestamp: Date.now()
            });
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
          const pendingImport = await importPendingSunoGeneration(input.workspaceRoot, song.songId, config);
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
          const budget = await reserveSunoGenerationBudget(input.workspaceRoot, 1);
          if (!budget.ok) {
            emitRuntimeEvent({
              type: "suno_budget_low",
              songId: song.songId,
              reason: budget.reason ?? "daily Suno budget low",
              limit: budget.state.limit,
              used: budget.state.used,
              timestamp: Date.now()
            });
            emitRuntimeEvent({
              type: "budget_exhausted",
              reason: budget.reason ?? "daily Suno budget exhausted",
              limit: budget.state.limit,
              used: budget.state.used,
              timestamp: Date.now()
            });
            return writeStageState(input.workspaceRoot, existing, {
              ...baseState,
              currentSongId: song.songId,
              stage: "suno_generation",
              blockedReason: budget.reason,
              lastError: budget.reason,
              lastSuccessfulStage: existing.lastSuccessfulStage,
              cycleCount: existing.cycleCount + 1
            });
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
            emitRuntimeEvent({
              type: "take_select_pending",
              songId: song.songId,
              reason: decision.reason,
              timestamp: Date.now()
            });
            return writeStageState(input.workspaceRoot, existing, {
              ...baseState,
              currentSongId: song.songId,
              stage: "take_selection",
              blockedReason: decision.reason,
              lastError: undefined,
              cycleCount: existing.cycleCount + 1
            });
          }
          if (decision.status === "low_score") {
            emitRuntimeEvent({
              type: "take_select_low_score",
              songId: song.songId,
              bestTakeId: decision.best.takeId,
              score: decision.best.total,
              reason: decision.reason,
              timestamp: Date.now()
            });
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
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            currentSongId: song.songId,
            stage: "take_selection",
            blockedReason: undefined,
            lastError: undefined,
            lastSuccessfulStage: "take_selection",
            cycleCount: existing.cycleCount + 1
          });
        }
        case "asset_generation": {
          await prepareSocialAssets({ workspaceRoot: input.workspaceRoot, songId: song.songId, config });
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
          return writeStageState(input.workspaceRoot, existing, {
            ...baseState,
            currentSongId: song.songId,
            stage: "failed_closed",
            hardStopReason: song.lastReason ?? "song marked failed",
            blockedReason: song.lastReason ?? "song marked failed"
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
    const stage = enabled ? state.stage : "idle";
    return {
      enabled,
      dryRun,
      stage,
      nextAction: nextActionForStage(stage),
      currentRunId: state.runId,
      currentSongId: state.currentSongId,
      lastSuccessfulStage: state.lastSuccessfulStage,
      pausedReason: state.pausedReason,
      hardStopReason: state.hardStopReason,
      blockedReason: state.blockedReason,
      lastError: state.lastError,
      retryCount: state.retryCount
    };
  }
}
