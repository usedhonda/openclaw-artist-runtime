import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyConfigDefaults } from "../config/schema.js";
import { BrowserWorkerSunoConnector } from "../connectors/suno/browserWorkerConnector.js";
import type {
  ArtistRuntimeConfig,
  AuthorityDecision,
  PromptLedgerEntry,
  SunoArtifactIndexEntry,
  SunoCreateResult,
  SunoImportedAssetMetadata,
  SunoRunRecord,
  SunoRunStatus
} from "../types.js";
import { listSongStates, updateSongState } from "./artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath, inspectJsonlFile } from "./promptLedger.js";
import { decideMusicAuthority } from "./musicAuthority.js";
import { applyRuntimeEnvOverrides } from "./runtimeConfig.js";
import {
  DEFAULT_SUNO_LIVE_CREATE_CREDIT_COST,
  SUNO_BUDGET_EXHAUSTED_REASON,
  SunoBudgetTracker
} from "./sunoBudget.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { SunoBrowserWorker } from "./sunoBrowserWorker.js";
import { extractSunoTakeId } from "./takeAttributionGuard.js";
import { getDurationPlan } from "../suno-production/durationPlan.js";

export interface GenerateSunoRunInput {
  workspaceRoot: string;
  songId: string;
  config?: Partial<ArtistRuntimeConfig>;
  workerState?: "disconnected" | "connected" | "login_challenge" | "captcha" | "payment_prompt" | "ui_mismatch" | "quota_exhausted" | "paused";
}

export interface ImportSunoResultsInput {
  workspaceRoot: string;
  songId: string;
  runId: string;
  urls: string[];
  selectedTakeId?: string;
  resultRefs?: string[];
  metadata?: SunoImportedAssetMetadata[];
  config?: Partial<ArtistRuntimeConfig>;
  preserveSongLifecycle?: boolean;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runId(prefix = "suno"): string {
  return `${prefix}_${Date.now().toString(36)}`;
}

function getRunsPath(root: string, songId: string): string {
  return join(root, "songs", songId, "suno", "runs.jsonl");
}

function getPayloadPath(root: string, songId: string): string {
  return join(root, "songs", songId, "suno", "suno-payload.json");
}

async function appendJsonl<T>(path: string, value: T): Promise<T> {
  const health = await inspectJsonlFile(path);
  if (!health.healthy) {
    throw new Error(`jsonl file is unhealthy: ${health.errors.join("; ")}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return value;
}

async function readLastJsonlEntry<T>(path: string): Promise<T | undefined> {
  const contents = await readFile(path, "utf8").catch(() => "");
  const lines = contents.split("\n").filter(Boolean);
  if (lines.length === 0) {
    return undefined;
  }
  return JSON.parse(lines.at(-1) as string) as T;
}

async function loadPayload(root: string, songId: string): Promise<{ payload: Record<string, unknown>; payloadHash: string; payloadPath: string }> {
  const payloadPath = getPayloadPath(root, songId);
  const payloadContents = await readFile(payloadPath, "utf8").catch(() => "");
  if (!payloadContents) {
    throw new Error(`missing Suno payload at ${payloadPath}`);
  }
  const payload = JSON.parse(payloadContents) as Record<string, unknown>;
  return { payload, payloadHash: hashPayload(payload), payloadPath };
}

function toRunStatus(allowed: boolean, dryRun: boolean, accepted: boolean): SunoRunStatus {
  if (!allowed && dryRun) {
    return "blocked_dry_run";
  }
  if (!allowed) {
    return "blocked_authority";
  }
  if (accepted) {
    return "accepted";
  }
  return "failed";
}

function generatedDurationSec(metadata: SunoImportedAssetMetadata[] | undefined): number | undefined {
  const durations = (metadata ?? [])
    .map((asset) => asset.durationSec)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return durations.length > 0 ? Math.max(...durations) : undefined;
}

function isCreateAttempt(run: SunoRunRecord): boolean {
  return run.status === "accepted";
}

function sameUtcDay(left: string, right: Date): boolean {
  return left.slice(0, 10) === right.toISOString().slice(0, 10);
}

function sameUtcMonth(left: string, right: Date): boolean {
  return left.slice(0, 7) === right.toISOString().slice(0, 7);
}

export async function evaluateSunoGenerationLimits(
  root: string,
  config: ArtistRuntimeConfig,
  now = new Date()
): Promise<AuthorityDecision | undefined> {
  const songs = await listSongStates(root);
  const runs = (
    await Promise.all(songs.map((song) => readAllSunoRuns(root, song.songId).catch(() => [])))
  ).flat().filter(isCreateAttempt);
  const dailyRuns = runs.filter((run) => sameUtcDay(run.createdAt, now));
  const monthlyRuns = runs.filter((run) => sameUtcMonth(run.createdAt, now));
  if (config.music.suno.maxGenerationsPerDay <= dailyRuns.length) {
    return {
      allowed: false,
      reason: `Suno daily generation limit reached (${dailyRuns.length}/${config.music.suno.maxGenerationsPerDay})`,
      hardStop: true,
      policyDecision: "stop_daily_generation_limit"
    };
  }
  if (config.music.suno.monthlyGenerationBudget <= monthlyRuns.length) {
    return {
      allowed: false,
      reason: `Suno monthly generation budget reached (${monthlyRuns.length}/${config.music.suno.monthlyGenerationBudget})`,
      hardStop: true,
      policyDecision: "stop_monthly_generation_budget"
    };
  }
  const latest = runs
    .map((run) => Date.parse(run.createdAt))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => right - left)[0];
  if (latest !== undefined) {
    const elapsedMs = now.getTime() - latest;
    const requiredMs = config.music.suno.minMinutesBetweenCreates * 60 * 1000;
    if (elapsedMs < requiredMs) {
      const remainingMinutes = Math.ceil((requiredMs - elapsedMs) / 60000);
      return {
        allowed: false,
        reason: `Suno create cooldown active (${remainingMinutes} min remaining)`,
        policyDecision: "stop_create_cooldown"
      };
    }
  }
  return undefined;
}

async function appendLedgerEntries(path: string, entries: PromptLedgerEntry[]): Promise<void> {
  for (const entry of entries) {
    await appendPromptLedger(path, entry);
  }
}

export async function readLatestSunoRun(root: string, songId: string): Promise<SunoRunRecord | undefined> {
  return readLastJsonlEntry<SunoRunRecord>(getRunsPath(root, songId));
}

export async function readAllSunoRuns(root: string, songId: string): Promise<SunoRunRecord[]> {
  const contents = await readFile(getRunsPath(root, songId), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SunoRunRecord)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function buildSunoArtifactIndex(root: string): Promise<SunoArtifactIndexEntry[]> {
  const runtimeRoot = join(root, "runtime", "suno");
  const runToSongId = new Map<string, string>();
  const songs = await listSongStates(root);
  await Promise.all(
    songs.map(async (song) => {
      const runs = await readAllSunoRuns(root, song.songId);
      for (const run of runs) {
        runToSongId.set(run.runId, song.songId);
      }
    })
  );

  const runDirs = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
  const entries = await Promise.all(
    runDirs
      .filter((entry) => entry.isDirectory())
      .map(async (runDir) => {
        const runId = runDir.name;
        const runPath = join(runtimeRoot, runId);
        const files = await readdir(runPath, { withFileTypes: true }).catch(() => []);
        const assets = await Promise.all(
          files
            .filter((file) => file.isFile() && (file.name.toLowerCase().endsWith(".mp3") || file.name.toLowerCase().endsWith(".m4a")))
            .map(async (file) => {
              const path = join(runPath, file.name);
              const fileStat = await stat(path);
              const format = file.name.toLowerCase().endsWith(".m4a") ? "m4a" : "mp3";
              return {
                runId,
                songId: runToSongId.get(runId),
                path,
                size: fileStat.size,
                format,
                createdAt: fileStat.mtime.toISOString()
              } satisfies SunoArtifactIndexEntry;
            })
        );
        return assets;
      })
  );

  return entries.flat().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function generateSunoRun(input: GenerateSunoRunInput): Promise<SunoRunRecord> {
  const config = applyRuntimeEnvOverrides(applyConfigDefaults(input.config));
  const connector = new BrowserWorkerSunoConnector(input.workspaceRoot, { config });
  const workerStatus = input.workerState
    ? { state: input.workerState }
    : await connector.status().catch(() => undefined);
  const workerState = workerStatus?.state ?? "disconnected";
  const { payload, payloadHash, payloadPath } = await loadPayload(input.workspaceRoot, input.songId);
  let authorityDecision = decideMusicAuthority({
    dryRun: config.autopilot.dryRun,
    authority: config.music.suno.authority,
    budgetRemaining: config.music.suno.monthlyGenerationBudget,
    connectionMode: config.music.suno.connectionMode,
    workerState,
    requestedAction: "create"
  });
  if (authorityDecision.allowed) {
    authorityDecision = await evaluateSunoGenerationLimits(input.workspaceRoot, config) ?? authorityDecision;
  }

  const createdAt = new Date().toISOString();
  const provisionalRunId = runId();
  const shouldReserveDailyCredits = !config.autopilot.dryRun && config.music.suno.submitMode === "live";
  const budgetTracker = new SunoBudgetTracker(input.workspaceRoot);
  const creditBudget = authorityDecision.allowed && shouldReserveDailyCredits
    ? await budgetTracker.reserve(
        DEFAULT_SUNO_LIVE_CREATE_CREDIT_COST,
        config.music.suno.dailyCreditLimit,
        config.music.suno.monthlyCreditLimit
      )
    : undefined;
  // Credits are reserved before the create attempt so the daily/monthly cap stays fail-closed.
  // A reservation only becomes a real spend when the create reaches a successful submit
  // (accepted === true). Any create that fails before submit (dom_missing, network, throw)
  // must refund the reservation, otherwise failed attempts silently burn budget.
  const reservedCredits = creditBudget?.ok === true ? DEFAULT_SUNO_LIVE_CREATE_CREDIT_COST : 0;
  let createResult: SunoCreateResult | undefined;
  try {
    createResult = authorityDecision.allowed
      ? creditBudget?.ok === false
        ? {
            accepted: false,
            runId: provisionalRunId,
            reason: creditBudget.reason ?? SUNO_BUDGET_EXHAUSTED_REASON,
            urls: [],
            dryRun: config.autopilot.dryRun
          }
        : await connector.create({
            dryRun: config.autopilot.dryRun,
            authority: config.music.suno.authority,
            payload,
            songId: input.songId,
            runId: provisionalRunId,
            payloadHash
          })
      : undefined;
  } finally {
    if (reservedCredits > 0 && createResult?.accepted !== true) {
      await budgetTracker.release(reservedCredits).catch((error) => {
        console.error(
          `[suno-budget] release after unsuccessful create failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }
  }
  const finalRunId = createResult?.runId ?? provisionalRunId;
  const record: SunoRunRecord = {
    runId: finalRunId,
    songId: input.songId,
    createdAt,
    mode: config.music.suno.connectionMode,
    authorityDecision,
    payloadHash,
    status: toRunStatus(authorityDecision.allowed, config.autopilot.dryRun, createResult?.accepted ?? false),
    dryRun: config.autopilot.dryRun,
    urls: createResult?.urls ?? [],
    lyricsTelemetry: createResult?.lyricsTelemetry,
    error: createResult?.accepted === false
      ? { name: "SunoCreateBlocked", message: createResult.reason }
      : undefined
  };

  const ledgerPath = getSongPromptLedgerPath(input.workspaceRoot, input.songId);
  await appendLedgerEntries(ledgerPath, [
    createPromptLedgerEntry({
      stage: "suno_prepare_to_create",
      songId: input.songId,
      runId: finalRunId,
      actor: "system",
      inputRefs: [payloadPath],
      outputRefs: [getRunsPath(input.workspaceRoot, input.songId)],
      payloadHash,
      policyDecision: authorityDecision,
      verification: { status: "pending", detail: "run record prepared" }
    }),
    createPromptLedgerEntry({
      stage: "suno_create",
      songId: input.songId,
      runId: finalRunId,
      actor: "connector",
      inputRefs: [payloadPath],
      outputRefs: [getRunsPath(input.workspaceRoot, input.songId)],
      payloadHash,
      policyDecision: authorityDecision,
      verification: {
        status: createResult?.accepted ? "verified" : "pending",
        detail: createResult?.reason ?? authorityDecision.reason
      },
      error: !authorityDecision.allowed || createResult?.accepted === false
        ? { name: "SunoCreateResult", message: createResult?.reason ?? authorityDecision.reason }
        : undefined
    })
  ]);

  await appendJsonl(getRunsPath(input.workspaceRoot, input.songId), record);
  const firstTakeUrl = createResult?.pendingTakeUrl ?? createResult?.urls.find(Boolean);
  const acceptedWithUrl = Boolean(authorityDecision.allowed && createResult?.accepted && firstTakeUrl);
  await updateSongState(input.workspaceRoot, input.songId, {
    status: acceptedWithUrl ? "suno_take_url_ready" : authorityDecision.allowed && createResult?.accepted ? "suno_running" : "suno_prompt_pack",
    reason: acceptedWithUrl ? "Suno take URL ready; audio rendering pending" : authorityDecision.reason,
    selectedTakeId: firstTakeUrl ? extractSunoTakeId(firstTakeUrl) ?? firstTakeUrl : undefined,
    appendPublicLinks: createResult?.accepted ? createResult.urls : undefined,
    runCountDelta: 1
  });

  return record;
}

export async function importSunoResults(input: ImportSunoResultsInput): Promise<SunoRunRecord> {
  const config = applyRuntimeEnvOverrides(applyConfigDefaults(input.config));
  const importedAt = new Date().toISOString();
  const payload = {
    runId: input.runId,
    urls: input.urls,
    selectedTakeId: input.selectedTakeId,
    resultRefs: input.resultRefs ?? []
  };
  const previousRun = await readAllSunoRuns(input.workspaceRoot, input.songId)
    .then((runs) => runs.find((run) => run.runId === input.runId))
    .catch(() => undefined);
  const previousTelemetry = previousRun?.lyricsTelemetry;
  const durationSec = generatedDurationSec(input.metadata);
  const durationPlan = getDurationPlan();
  const durationDeltaSec = durationSec === undefined ? undefined : durationSec - durationPlan.targetSeconds;
  const resultsDir = join(input.workspaceRoot, "songs", input.songId, "suno");
  const latestResultsPath = join(resultsDir, "latest-results.json");
  const versionedResultsPath = join(resultsDir, `${input.runId}.results.json`);
  await mkdir(resultsDir, { recursive: true });
  await Promise.all([
    writeFile(latestResultsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8"),
    writeFile(versionedResultsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  ]);

  const importedRecord: SunoRunRecord = {
    runId: input.runId,
    songId: input.songId,
    createdAt: importedAt,
    mode: config.music.suno.connectionMode,
    authorityDecision: {
      allowed: true,
      reason: "local import recorded",
      policyDecision: "import_results"
    },
    payloadHash: hashPayload(payload),
    status: "imported",
    dryRun: config.autopilot.dryRun,
    urls: input.urls,
    lyricsTelemetry: previousTelemetry,
    generatedDurationSec: durationSec,
    durationDeltaSec
  };

  await appendPromptLedger(
    getSongPromptLedgerPath(input.workspaceRoot, input.songId),
    createPromptLedgerEntry({
      stage: "suno_result_import",
      songId: input.songId,
      runId: input.runId,
      actor: "system",
      inputRefs: input.resultRefs ?? [],
      outputRefs: [latestResultsPath, versionedResultsPath, getRunsPath(input.workspaceRoot, input.songId)],
      payloadHash: importedRecord.payloadHash,
      policyDecision: importedRecord.authorityDecision,
      verification: { status: "verified", detail: `${input.urls.length} URL(s) imported` }
    })
  );

  await appendJsonl(getRunsPath(input.workspaceRoot, input.songId), importedRecord);
  const lastImportOutcome = {
    runId: input.runId,
    urlCount: input.urls.length,
    pathCount: input.resultRefs?.length ?? 0,
    paths: input.resultRefs ?? [],
    metadata: input.metadata,
    failedUrls: [],
    reason: "Suno results imported",
    at: importedAt,
    generatedDurationSec: durationSec,
    durationDeltaSec,
    dryRun: config.autopilot.dryRun
  };

  await updateSongState(input.workspaceRoot, input.songId, {
    status: input.preserveSongLifecycle ? undefined : "takes_imported",
    reason: input.preserveSongLifecycle ? "Suno results imported after adoption" : "Suno results imported",
    selectedTakeId: input.selectedTakeId,
    appendPublicLinks: input.urls,
    lastImportOutcome
  });
  await new SunoBrowserWorker(input.workspaceRoot).supersedeImportOutcome(lastImportOutcome);
  if (input.preserveSongLifecycle) {
    emitRuntimeEvent({
      type: "suno_adoption_download_imported",
      songId: input.songId,
      runId: input.runId,
      urls: input.urls,
      paths: input.resultRefs ?? [],
      selectedTakeId: input.selectedTakeId,
      timestamp: Date.now()
    });
  } else {
    emitRuntimeEvent({
      type: "take_imported",
      songId: input.songId,
      paths: input.resultRefs ?? [],
      metadata: input.metadata ?? [],
      timestamp: Date.now()
    });
  }

  return importedRecord;
}
