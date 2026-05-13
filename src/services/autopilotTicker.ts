import { applyConfigDefaults } from "../config/schema.js";
import type { AutopilotRunState, ArtistRuntimeConfig } from "../types.js";
import { ArtistAutopilotService, readAutopilotRunState } from "./autopilotService.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

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
let running = false;
let singleton: AutopilotTicker | null = null;
let lastOutcome: AutopilotTickOutcome | undefined;
let lastTickAt: string | undefined;

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
  }

  async tick(configOverride?: PartialDeep<ArtistRuntimeConfig>): Promise<AutopilotTickOutcome> {
    return (await this.runNow(configOverride)).outcome;
  }

  async runNow(configOverride?: PartialDeep<ArtistRuntimeConfig>, manualSeed?: { hint: string }): Promise<AutopilotManualRunResult> {
    const baseConfig = configOverride ?? this.options.getConfig?.();
    const resolved = applyConfigDefaults(baseConfig);
    const workspaceRoot = resolved.artist.workspaceRoot;

    if (!manualSeed && !resolved.autopilot.enabled) {
      return {
        outcome: this.emit("skipped:disabled"),
        state: await readAutopilotRunState(workspaceRoot)
      };
    }

    const state = await readAutopilotRunState(workspaceRoot);
    if (state.paused) {
      return { outcome: this.emit("skipped:paused"), state };
    }
    if (state.hardStopReason) {
      return { outcome: this.emit("skipped:hardStop"), state };
    }
    if (running) {
      return { outcome: this.emit("skipped:concurrent"), state };
    }

    running = true;
    try {
      const nextState = await new ArtistAutopilotService().runCycle({
        workspaceRoot,
        config: resolved,
        manualSeed
      });
      return {
        outcome: this.emit("ran"),
        state: nextState
      };
    } catch {
      return {
        outcome: this.emit("error"),
        state: await readAutopilotRunState(workspaceRoot)
      };
    } finally {
      running = false;
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
  singleton = null;
  running = false;
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
