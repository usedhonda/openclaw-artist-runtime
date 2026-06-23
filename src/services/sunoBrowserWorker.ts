import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtistRuntimeConfig,
  SunoCreateRequest,
  SunoCreateResult,
  SunoImportRequest,
  SunoImportFailedUrl,
  SunoImportFailureReason,
  SunoImportResult,
  SunoLoginHandoff,
  SunoDriverMode,
  SunoSubmitMode,
  SongStateImportOutcome,
  SunoWorkerState,
  SunoWorkerStatus
} from "../types.js";
import { getDurationPlan } from "../suno-production/durationPlan.js";
import { DEFAULT_SUNO_PROFILE_PATH, PlaywrightSunoDriver } from "./sunoPlaywrightDriver.js";
import { DEFAULT_SUNO_PROFILE_STALE_DAYS, detectStaleProfile } from "./sunoProfileLifecycle.js";
import { isSunoLiveDisabled, isSunoLiveEnabled, sunoChromeProfileDest } from "./runtimeConfig.js";

type SunoWorkerProbeState = Extract<
  SunoWorkerState,
  "connected" | "login_required" | "login_challenge" | "captcha" | "payment_prompt" | "ui_mismatch" | "quota_exhausted" | "disconnected"
>;

export interface SunoBrowserDriverProbe {
  state: SunoWorkerProbeState;
  detail?: string;
}

export interface SunoBrowserDriver {
  probe(): Promise<SunoBrowserDriverProbe>;
  create?(request: SunoCreateRequest): Promise<SunoCreateResult>;
  importResults?(request: SunoImportRequest): Promise<SunoImportResult>;
  stop?(): Promise<void>;
}

interface StartOptions {
  driver?: SunoBrowserDriver;
  requestedAction?: "operator_login_required" | "reconnect_requested";
}

interface WorkerAutomationOptions {
  driver?: SunoBrowserDriver;
  dryRun?: boolean;
}

interface SunoBrowserWorkerOptions {
  config?: Partial<ArtistRuntimeConfig>;
  driverMode?: SunoDriverMode;
  profilePath?: string;
  submitMode?: SunoSubmitMode;
}

function logSunoWorkerSideEffectFailure(context: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[suno-browser-worker] ${context} failed: ${reason}`);
}

function now(): string {
  return new Date().toISOString();
}

function generatedDurationSec(metadata: SunoImportResult["metadata"]): number | undefined {
  const durations = (metadata ?? [])
    .map((asset) => asset.durationSec)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return durations.length > 0 ? Math.max(...durations) : undefined;
}

function isHardStopState(state: SunoWorkerState): state is Extract<SunoWorkerState, "login_challenge" | "captcha" | "payment_prompt" | "ui_mismatch" | "quota_exhausted"> {
  return state === "login_challenge" || state === "captcha" || state === "payment_prompt" || state === "ui_mismatch" || state === "quota_exhausted";
}

function buildHandoffReason(
  state: SunoWorkerProbeState,
  requestedAction: StartOptions["requestedAction"]
): SunoLoginHandoff["reason"] {
  if (state === "login_required") {
    return requestedAction ?? "operator_login_required";
  }
  return state === "login_challenge" || state === "captcha" || state === "payment_prompt"
    ? state
    : "operator_login_required";
}

function buildHandoffMessage(state: SunoWorkerProbeState, detail?: string): string {
  if (detail) {
    return detail;
  }

  switch (state) {
    case "login_required":
      return "Suno login required. Operator must complete login in the dedicated browser session.";
    case "login_challenge":
      return "Suno login challenge detected. Operator must complete the challenge before automation resumes.";
    case "captcha":
      return "Suno CAPTCHA detected. Operator must resolve it manually before automation resumes.";
    case "payment_prompt":
      return "Suno payment or credit prompt detected. Operator review is required before automation resumes.";
    case "ui_mismatch":
      return "Suno UI mismatch detected. Automation is paused until the worker contract is updated.";
    case "quota_exhausted":
      return "Suno quota appears exhausted. Automation is paused until budget is available again.";
    default:
      return "Suno worker needs operator attention.";
  }
}

function classifyImportFailure(reason?: string): SunoImportFailureReason {
  const normalized = (reason ?? "").toLowerCase();
  if (normalized.includes("404")) {
    return "404";
  }
  if (
    normalized.includes("network")
    || normalized.includes("timeout")
    || normalized.includes("econn")
    || normalized.includes("enotfound")
    || normalized.includes("socket")
    || normalized.includes("fetch")
  ) {
    return "network";
  }
  return "extraction_failed";
}

function inferFailedImportUrls(requestedUrls: string[], result: SunoImportResult): SunoImportFailedUrl[] {
  if (result.failedUrls?.length) {
    return result.failedUrls;
  }
  const importedUrls = new Set(result.metadata?.map((asset) => asset.url) ?? result.urls);
  return requestedUrls
    .filter((url) => !importedUrls.has(url))
    .map((url) => ({
      url,
      reason: classifyImportFailure(result.reason)
    }));
}

export function workerImportOutcomeFromSong(outcome: SongStateImportOutcome): SunoWorkerStatus["lastImportOutcome"] {
  return {
    runId: outcome.runId,
    urlCount: outcome.urlCount,
    pathCount: outcome.pathCount,
    paths: outcome.paths,
    failedUrls: outcome.failedUrls,
    reason: outcome.reason,
    at: outcome.at,
    dryRun: outcome.dryRun
  };
}

export class SunoBrowserWorker {
  constructor(
    private readonly workspaceRoot = ".",
    private readonly options: SunoBrowserWorkerOptions = {}
  ) {}

  private statePath(): string {
    return join(this.workspaceRoot, "runtime", "suno-worker.json");
  }

  private defaultState(): SunoWorkerStatus {
    return {
      state: "disconnected",
      connected: false,
      lastTransitionAt: now(),
      failureCount: 0
    };
  }

  private async readState(): Promise<SunoWorkerStatus> {
    const contents = await readFile(this.statePath(), "utf8").catch(() => "");
    if (!contents) {
      return this.defaultState();
    }
    return JSON.parse(contents) as SunoWorkerStatus;
  }

  private async writeState(next: SunoWorkerStatus): Promise<SunoWorkerStatus> {
    await mkdir(join(this.workspaceRoot, "runtime"), { recursive: true });
    await writeFile(this.statePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  private profilePath(): string {
    return this.options.profilePath ?? sunoChromeProfileDest() ?? DEFAULT_SUNO_PROFILE_PATH;
  }

  private shouldCheckProfileLifecycle(): boolean {
    return Boolean(
      this.options.profilePath
      || this.options.driverMode === "playwright"
      || this.options.config?.music?.suno?.driver === "playwright"
    );
  }

  private async withProfileLifecycleStatus(status: SunoWorkerStatus): Promise<SunoWorkerStatus> {
    if (!this.shouldCheckProfileLifecycle()) {
      return status;
    }

    const profile = await detectStaleProfile(this.profilePath(), DEFAULT_SUNO_PROFILE_STALE_DAYS).catch((error) => ({
      profilePath: this.profilePath(),
      checkedAt: now(),
      stale: true,
      reason: "missing" as const,
      detail: `Suno profile lifecycle check failed: ${error instanceof Error ? error.message : String(error)}`
    }));
    if (profile.stale) {
      console.warn(`[artist-runtime] ${profile.detail}`);
    }

    return {
      ...status,
      sunoProfileStale: profile.stale,
      sunoProfileDetail: profile.detail,
      sunoProfileCheckedAt: profile.checkedAt
    };
  }

  private async transition(next: Partial<SunoWorkerStatus>): Promise<SunoWorkerStatus> {
    const current = await this.readState();
    const resolved: SunoWorkerStatus = {
      ...current,
      ...next,
      state: next.state ?? current.state,
      connected: next.connected ?? (next.state ? next.state === "connected" : current.connected),
      lastTransitionAt: now()
    };
    if (resolved.failureCount === undefined) {
      resolved.failureCount = current.failureCount ?? 0;
    }
    return this.writeState(resolved);
  }

  private async requireOperatorBridge(
    state: Extract<SunoWorkerProbeState, "login_required" | "login_challenge" | "captcha" | "payment_prompt">,
    requestedAction?: StartOptions["requestedAction"],
    detail?: string
  ): Promise<SunoWorkerStatus> {
    const current = await this.readState();
    const message = buildHandoffMessage(state, detail);
    const handoffReason = buildHandoffReason(state, requestedAction);
    const loginHandoff: SunoLoginHandoff = {
      state: "waiting_for_operator",
      reason: handoffReason,
      message,
      requestedAt: now()
    };
    return this.writeState({
      ...current,
      state,
      connected: false,
      pendingAction: requestedAction ?? "operator_login_required",
      hardStopReason: message,
      failureCount: isHardStopState(state) ? (current.failureCount ?? 0) + 1 : current.failureCount ?? 0,
      lastTransitionAt: now(),
      loginHandoff
    });
  }

  private resolveDriver(explicitDriver?: SunoBrowserDriver): SunoBrowserDriver | undefined {
    if (explicitDriver) {
      return explicitDriver;
    }

    const driverMode = isSunoLiveDisabled()
      ? "mock"
      : isSunoLiveEnabled()
        ? "playwright"
        : this.options.driverMode ?? this.options.config?.music?.suno?.driver ?? "mock";
    if (driverMode === "playwright") {
      return new PlaywrightSunoDriver(
        this.profilePath(),
        this.options.submitMode ?? (isSunoLiveEnabled() ? "live" : this.options.config?.music?.suno?.submitMode ?? "skip"),
        this.workspaceRoot
      );
    }

    return undefined;
  }

  private async prepareCopiedProfile(): Promise<void> {
    // Plan v10.33: profile copy 路線を deprecate。
    // Plan v9.24b で Cookies+IndexedDB+SW+encryption key の transplant が architecturally
    // 不可と確定 (memory `project_plan_v9_24b_profile_copy_dead_end`)。
    // Suno worker は artist 専用 user data dir (`.openclaw-browser-profiles/suno`) を
    // `scripts/openclaw-suno-login.mjs` 経由の 1 回手動 sign in で初期化する運用に切替。
    return;
  }

  async start(options: StartOptions = {}): Promise<SunoWorkerStatus> {
    await this.transition({
      state: "connecting",
      connected: false,
      pendingAction: options.requestedAction ?? "operator_login_required",
      hardStopReason: undefined
    });

    await this.prepareCopiedProfile();
    const driver = this.resolveDriver(options.driver);
    const probe = driver
      ? await driver.probe()
      : { state: "login_required", detail: undefined } satisfies SunoBrowserDriverProbe;

    if (probe.state === "connected") {
      return this.transition({
        state: "connected",
        connected: true,
        pendingAction: undefined,
        hardStopReason: undefined,
        loginHandoff: undefined
      });
    }

    if (probe.state === "login_required" || probe.state === "login_challenge" || probe.state === "captcha" || probe.state === "payment_prompt") {
      return this.requireOperatorBridge(probe.state, options.requestedAction, probe.detail);
    }

    const message = buildHandoffMessage(probe.state, probe.detail);
    const current = await this.readState();
    return this.writeState({
      ...current,
      state: probe.state,
      connected: false,
      pendingAction: options.requestedAction,
      hardStopReason: isHardStopState(probe.state) ? message : undefined,
      failureCount: isHardStopState(probe.state) ? (current.failureCount ?? 0) + 1 : current.failureCount ?? 0,
      lastTransitionAt: now(),
      loginHandoff: undefined
    });
  }

  async setState(state: SunoWorkerState, hardStopReason?: string, pendingAction?: string): Promise<SunoWorkerStatus> {
    const current = await this.readState();
    const next: SunoWorkerStatus = {
      ...current,
      state,
      connected: state === "connected",
      hardStopReason,
      pendingAction,
      lastTransitionAt: now()
    };
    if (state === "login_challenge" || state === "captcha" || state === "payment_prompt" || state === "ui_mismatch" || state === "quota_exhausted") {
      next.failureCount = (current.failureCount ?? 0) + 1;
    }
    return this.writeState(next);
  }

  async supersedeImportOutcome(outcome: SongStateImportOutcome): Promise<SunoWorkerStatus> {
    const current = await this.readState();
    return this.writeState({
      ...current,
      lastImportOutcome: workerImportOutcomeFromSong(outcome),
      lastImportedRunId: outcome.runId,
      lastTransitionAt: now()
    });
  }

  async pause(reason = "paused by operator"): Promise<SunoWorkerStatus> {
    return this.setState("paused", reason);
  }

  async connect(): Promise<SunoWorkerStatus> {
    return this.setState("disconnected", undefined, "operator_login_required");
  }

  async reconnect(): Promise<SunoWorkerStatus> {
    return this.setState("disconnected", undefined, "reconnect_requested");
  }

  async completeManualLoginHandoff(): Promise<SunoWorkerStatus> {
    const current = await this.readState();
    const nextHandoff = current.loginHandoff
      ? {
          ...current.loginHandoff,
          state: "completed" as const,
          completedAt: now()
        }
      : undefined;
    return this.writeState({
      ...current,
      state: "connected",
      connected: true,
      hardStopReason: undefined,
      pendingAction: undefined,
      lastTransitionAt: now(),
      loginHandoff: nextHandoff
    });
  }

  async stop(driver?: SunoBrowserDriver): Promise<SunoWorkerStatus> {
    const current = await this.readState();
    if (current.state === "stopped") {
      return current;
    }
    await this.prepareCopiedProfile();
    const resolvedDriver = this.resolveDriver(driver);
    await resolvedDriver?.stop?.().catch((error) => logSunoWorkerSideEffectFailure("driver stop", error));
    return this.writeState({
      ...current,
      state: "stopped",
      connected: false,
      pendingAction: undefined,
      lastTransitionAt: now()
    });
  }

  async status(): Promise<SunoWorkerStatus> {
    return this.withProfileLifecycleStatus(await this.readState());
  }

  async startCreate(request: SunoCreateRequest, options: WorkerAutomationOptions = {}): Promise<SunoCreateResult> {
    const current = await this.readState();
    const dryRun = options.dryRun ?? request.dryRun;
    const runId = request.runId ?? `worker_${Date.now().toString(36)}`;
    await this.prepareCopiedProfile();
    const driver = this.resolveDriver(options.driver);

    if (!dryRun && current.state !== "connected") {
      const blockedResult = {
        accepted: false,
        runId,
        reason: "suno_worker_not_connected",
        urls: []
      };
      await this.transition({
        lastCreateOutcome: {
          runId,
          accepted: false,
          reason: blockedResult.reason,
          at: now(),
          dryRun
        }
      });
      return blockedResult;
    }

    await this.transition({
      state: "generating",
      connected: true,
      pendingAction: "suno_create",
      currentRunId: runId,
      hardStopReason: undefined
    });

    if (dryRun) {
      await this.transition({
        state: "connected",
        connected: true,
        pendingAction: undefined,
        currentRunId: runId,
        lastCreateOutcome: {
          runId,
          accepted: false,
          reason: "dry-run blocks Suno create",
          at: now(),
          dryRun: true
        }
      });
      return {
        accepted: false,
        runId,
        reason: "dry-run blocks Suno create",
        urls: [],
        dryRun: true
      };
    }

    if (!driver?.create) {
      await this.transition({
        state: "connected",
        connected: true,
        pendingAction: undefined,
        currentRunId: runId,
        hardStopReason: "Suno browser driver create() is not configured.",
        lastCreateOutcome: {
          runId,
          accepted: false,
          reason: "suno_browser_driver_missing_create",
          at: now(),
          dryRun
        }
      });
      return {
        accepted: false,
        runId,
        reason: "suno_browser_driver_missing_create",
        urls: []
      };
    }

    const result = await driver.create({ ...request, dryRun, runId });
    await this.transition({
      state: result.accepted ? "generating" : "connected",
      connected: true,
      pendingAction: result.accepted ? "waiting_for_results" : undefined,
      currentRunId: result.runId,
      hardStopReason: result.accepted ? undefined : result.reason,
      lastCreateOutcome: {
        runId: result.runId,
        accepted: result.accepted,
        reason: result.reason,
        at: now(),
        lyricsTelemetry: result.lyricsTelemetry,
        dryRun: result.dryRun ?? dryRun
      }
    });
    return result;
  }

  async importRun(runId: string, urls: string[] = [], options: WorkerAutomationOptions = {}): Promise<SunoImportResult> {
    const current = await this.readState();
    const dryRun = options.dryRun ?? false;
    await this.prepareCopiedProfile();
    const driver = this.resolveDriver(options.driver);

    if (!dryRun && current.state !== "connected" && current.state !== "generating") {
      const blockedResult = {
        runId,
        urls: [],
        reason: "suno_worker_not_ready_for_import"
      };
      await this.transition({
        lastImportOutcome: {
          runId,
          urlCount: 0,
          pathCount: 0,
          paths: [],
          metadata: [],
          failedUrls: [],
          reason: blockedResult.reason,
          at: now(),
          dryRun
        }
      });
      return blockedResult;
    }

    await this.transition({
      state: "importing",
      connected: true,
      pendingAction: "suno_import_results",
      currentRunId: runId,
      hardStopReason: undefined
    });

    if (dryRun) {
      await this.transition({
        state: "connected",
        connected: true,
        pendingAction: undefined,
        currentRunId: runId,
        lastImportedRunId: runId,
        lastImportOutcome: {
          runId,
          urlCount: 0,
          pathCount: 0,
          paths: [],
          metadata: [],
          failedUrls: [],
          reason: "dry-run blocks Suno import",
          at: now(),
          dryRun: true
        }
      });
      return {
        accepted: false,
        runId,
        urls: [],
        paths: [],
        importedAt: now(),
        reason: "dry-run blocks Suno import",
        dryRun: true
      };
    }

    if (!driver?.importResults) {
      await this.transition({
        state: "connected",
        connected: true,
        pendingAction: undefined,
        currentRunId: runId,
        hardStopReason: "Suno browser driver importResults() is not configured.",
        lastImportOutcome: {
          runId,
          urlCount: 0,
          pathCount: 0,
          paths: [],
          metadata: [],
          failedUrls: [],
          reason: "suno_browser_driver_missing_import",
          at: now(),
          dryRun
        }
      });
      return {
        accepted: false,
        runId,
        urls: [],
        paths: [],
        reason: "suno_browser_driver_missing_import"
      };
    }

    const result = await driver.importResults({ runId, urls });
    const failedUrls = inferFailedImportUrls(urls, result);
    const durationSec = generatedDurationSec(result.metadata);
    const durationPlan = getDurationPlan();
    const durationDeltaSec = durationSec === undefined ? undefined : durationSec - durationPlan.targetSeconds;
    await this.transition({
      state: "connected",
      connected: true,
      pendingAction: undefined,
      currentRunId: result.runId ?? runId,
      lastImportedRunId: result.runId ?? runId,
      hardStopReason: undefined,
      lastImportOutcome: {
        runId: result.runId ?? runId,
        urlCount: result.urls.length,
        pathCount: result.paths?.length ?? 0,
        paths: result.paths,
        metadata: result.metadata,
        failedUrls,
        reason: result.reason,
        at: result.importedAt ?? now(),
        generatedDurationSec: durationSec,
        durationDeltaSec,
        dryRun: result.dryRun
      }
    });
    return {
      ...result,
      runId: result.runId ?? runId,
      importedAt: result.importedAt ?? now(),
      failedUrls
    };
  }
}
