import { applyConfigDefaults } from "../config/schema.js";
import type { AutopilotRunState, ArtistRuntimeConfig } from "../types.js";
import { ArtistAutopilotService, readAutopilotRunState, PRODUCER_REVIEW_SUSPENDED_AT } from "./autopilotService.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { getAutopilotFastChainMs, getAutopilotTickStallMs } from "./runtimeConfig.js";
import { writeAutopilotHeartbeat } from "./supervisorHealth.js";

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends string[] ? string[] : T[K] extends Record<string, unknown> ? PartialDeep<T[K]> : T[K];
};

export type AutopilotTickOutcome =
  | "ran"
  | "skipped:disabled"
  | "skipped:paused"
  | "skipped:hardStop"
  | "skipped:concurrent"
  | "error";

export interface AutopilotTickerOptions {
  intervalMs?: number;
  getConfig?: () => PartialDeep<ArtistRuntimeConfig> | undefined;
  onOutcome?: (outcome: AutopilotTickOutcome) => void;
}

export interface AutopilotManualRunResult {
  outcome: AutopilotTickOutcome;
  state: AutopilotRunState;
}

const FALLBACK_INTERVAL_MS = 5 * 60 * 1000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let fastChainHandle: ReturnType<typeof setTimeout> | null = null;
let running = false;
let runningStartedAt: number | undefined;
let singleton: AutopilotTicker | null = null;
let lastOutcome: AutopilotTickOutcome | undefined;
let lastTickAt: string | undefined;

const FALLBACK_STALL_MS = 10 * 60 * 1000;

// When a cycle advances an in-flight song (e.g. suno_generation -> import -> take
// selection), the next stage would otherwise wait the full cycle interval (default
// 3h), so a song that finished generating sits undelivered for hours. A successful
// cycle that made progress and is not waiting on the operator schedules a near-term
// follow-up tick to drive the pipeline tail (create -> import -> take_completed ->
// Telegram) within ~minutes. Set OPENCLAW_AUTOPILOT_FAST_CHAIN_MS=0 to disable.
const FALLBACK_FAST_CHAIN_MS = 20 * 1000;

// Stages where the pipeline is idle or terminal: nothing to fast-chain toward.
const FAST_CHAIN_STOP_STAGES = new Set(["idle", "paused", "completed", "failed_closed"]);

function resolveStallMs(): number {
  return getAutopilotTickStallMs() ?? FALLBACK_STALL_MS;
}

function resolveFastChainMs(): number {
  return getAutopilotFastChainMs() ?? FALLBACK_FAST_CHAIN_MS;
}

// Progress fingerprint: a same-stage advance (e.g. create -> pending import within
// suno_generation) changes blockedReason, so stage alone is too coarse. Comparing the
// full tuple lets a same-stage advance chain while a no-progress repeat stops it.
function progressKey(state: AutopilotRunState): string {
  return `${state.stage}|${state.blockedReason ?? ""}|${state.currentSongId ?? ""}`;
}

function shouldFastChain(before: AutopilotRunState, after: AutopilotRunState): boolean {
  if (after.paused) return false;
  if (after.suspendedAt) return false;
  if (after.hardStopReason) return false;
  if (FAST_CHAIN_STOP_STAGES.has(after.stage)) return false;
  // Only chain when this cycle actually moved the pipeline forward; a repeated state
  // (e.g. import still not ready) falls back to the normal interval to avoid runaway.
  return progressKey(before) !== progressKey(after);
}

function logHeartbeatFailure(context: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[autopilot-ticker] ${context} failed: ${reason}`);
}

export class AutopilotTicker {
  constructor(private readonly options: AutopilotTickerOptions = {}) {}

  start(): void {
    if (intervalHandle) {
      return;
    }
    const intervalMs = this.resolveIntervalMs();
    void this.tick();
    intervalHandle = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (fastChainHandle) {
      clearTimeout(fastChainHandle);
      fastChainHandle = null;
    }
  }

  // Drive the pipeline tail without waiting the full cycle interval. Scheduled as a
  // one-shot; the next runNow re-evaluates from fresh on-disk state, and its running
  // guard prevents overlap with the regular interval tick.
  private maybeScheduleFastChain(before: AutopilotRunState, after: AutopilotRunState): void {
    const delayMs = resolveFastChainMs();
    if (delayMs <= 0) return;
    if (!shouldFastChain(before, after)) return;
    if (fastChainHandle) {
      clearTimeout(fastChainHandle);
    }
    fastChainHandle = setTimeout(() => {
      fastChainHandle = null;
      void this.tick();
    }, delayMs);
    if (typeof fastChainHandle.unref === "function") {
      fastChainHandle.unref();
    }
  }

  async tick(configOverride?: PartialDeep<ArtistRuntimeConfig>): Promise<AutopilotTickOutcome> {
    return (await this.runNow(configOverride)).outcome;
  }

  async runNow(configOverride?: PartialDeep<ArtistRuntimeConfig>, manualSeed?: { hint: string }): Promise<AutopilotManualRunResult> {
    const baseConfig = configOverride ?? this.options.getConfig?.();
    const resolved = applyConfigDefaults(baseConfig);
    const workspaceRoot = resolved.artist.workspaceRoot;
    await writeAutopilotHeartbeat(workspaceRoot, {
      lastTickAttempt: new Date().toISOString()
    }).catch((error) => logHeartbeatFailure("heartbeat attempt write", error));

    if (!manualSeed && !resolved.autopilot.enabled) {
      return {
        outcome: await this.emitWithHeartbeat(workspaceRoot, "skipped:disabled"),
        state: await readAutopilotRunState(workspaceRoot)
      };
    }

    const state = await readAutopilotRunState(workspaceRoot);
    // Plan v10.54 Phase C wire fix: producer_review_after_take_selected は paused でも
    // runCycle に通す。runCycle 内 runIdeaQueueLane が currentSongId lane を停止維持したまま
    // ideaQueue lane だけ tick する (御大「自然と新曲提案降ってくる」)。それ以外の paused
    // (operator pause / safety stop) は従来どおり skip。
    if (state.paused && state.suspendedAt !== PRODUCER_REVIEW_SUSPENDED_AT) {
      return { outcome: await this.emitWithHeartbeat(workspaceRoot, "skipped:paused", state), state };
    }
    if (state.hardStopReason) {
      return { outcome: await this.emitWithHeartbeat(workspaceRoot, "skipped:hardStop", state), state };
    }
    if (running) {
      const startedAt = runningStartedAt;
      const ageMs = typeof startedAt === "number" ? Date.now() - startedAt : 0;
      if (!startedAt || ageMs < resolveStallMs()) {
        return { outcome: await this.emitWithHeartbeat(workspaceRoot, "skipped:concurrent", state), state };
      }
      running = false;
      runningStartedAt = undefined;
      emitRuntimeEvent({
        type: "error",
        source: "autopilot_ticker_stall",
        reason: `tick_stalled:${ageMs}ms`,
        songId: state.currentSongId,
        timestamp: Date.now()
      });
    }

    running = true;
    runningStartedAt = Date.now();
    try {
      const nextState = await new ArtistAutopilotService().runCycle({
        workspaceRoot,
        config: resolved,
        manualSeed
      });
      this.maybeScheduleFastChain(state, nextState);
      return {
        outcome: await this.emitWithHeartbeat(workspaceRoot, "ran", nextState),
        state: nextState
      };
    } catch {
      const errorState = await readAutopilotRunState(workspaceRoot);
      return {
        outcome: await this.emitWithHeartbeat(workspaceRoot, "error", errorState),
        state: errorState
      };
    } finally {
      running = false;
      runningStartedAt = undefined;
    }
  }

  private resolveIntervalMs(): number {
    if (this.options.intervalMs) {
      return this.options.intervalMs;
    }
    const baseConfig = this.options.getConfig?.();
    const resolved = applyConfigDefaults(baseConfig);
    const minutes = resolved.autopilot.cycleIntervalMinutes;
    if (typeof minutes === "number" && minutes > 0) {
      return minutes * 60 * 1000;
    }
    return FALLBACK_INTERVAL_MS;
  }

  private emit(outcome: AutopilotTickOutcome): AutopilotTickOutcome {
    lastOutcome = outcome;
    lastTickAt = new Date().toISOString();
    emitRuntimeEvent({
      type: "autopilot_state_changed",
      enabled: outcome !== "skipped:disabled",
      paused: outcome === "skipped:paused",
      reason: outcome,
      timestamp: Date.now()
    });
    this.options.onOutcome?.(outcome);
    return outcome;
  }

  private async emitWithHeartbeat(
    workspaceRoot: string,
    outcome: AutopilotTickOutcome,
    state?: AutopilotRunState
  ): Promise<AutopilotTickOutcome> {
    const emitted = this.emit(outcome);
    await writeAutopilotHeartbeat(workspaceRoot, {
      lastTickResult: emitted,
      currentStage: state?.stage
    }).catch((error) => logHeartbeatFailure("heartbeat result write", error));
    return emitted;
  }
}

export function getAutopilotTicker(options?: AutopilotTickerOptions): AutopilotTicker {
  if (!singleton) {
    singleton = new AutopilotTicker(options);
  }
  return singleton;
}

export function resetAutopilotTickerForTest(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (fastChainHandle) {
    clearTimeout(fastChainHandle);
    fastChainHandle = null;
  }
  singleton = null;
  running = false;
  runningStartedAt = undefined;
  lastOutcome = undefined;
  lastTickAt = undefined;
}

export function getLastOutcome(): AutopilotTickOutcome | undefined {
  return lastOutcome;
}

export function getLastTickAt(): string | undefined {
  return lastTickAt;
}

export function getAutopilotTickerIntervalMs(config?: PartialDeep<ArtistRuntimeConfig>): number {
  if (config?.autopilot?.cycleIntervalMinutes && config.autopilot.cycleIntervalMinutes > 0) {
    return config.autopilot.cycleIntervalMinutes * 60 * 1000;
  }
  return FALLBACK_INTERVAL_MS;
}
