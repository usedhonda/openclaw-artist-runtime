import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyConfigDefaults } from "../config/schema.js";
import { BrowserWorkerSunoConnector } from "../connectors/suno/browserWorkerConnector.js";
import type {
  ArtistRuntimeConfig,
  PromptLedgerEntry,
  SunoArtifactIndexEntry,
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
  config?: Partial<ArtistRuntimeConfig>;
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
  const workerStatus = input.workerState ? { state: input.workerState } : await connector.status();
  const { payload, payloadHash, payloadPath } = await loadPayload(input.workspaceRoot, input.songId);
  const authorityDecision = decideMusicAuthority({
    dryRun: config.autopilot.dryRun,
    authority: config.music.suno.authority,
    budgetRemaining: config.music.suno.monthlyGenerationBudget,
    connectionMode: config.music.suno.connectionMode,
    workerState: workerStatus.state,
    requestedAction: "create"
  });

  const createdAt = new Date().toISOString();
  const provisionalRunId = runId();
  const shouldReserveDailyCredits = !config.autopilot.dryRun && config.music.suno.submitMode === "live";
  const dailyBudget = authorityDecision.allowed && shouldReserveDailyCredits
    ? await new SunoBudgetTracker(input.workspaceRoot).reserve(
        DEFAULT_SUNO_LIVE_CREATE_CREDIT_COST,
        config.music.suno.dailyCreditLimit,
        config.music.suno.monthlyCreditLimit
      )
    : undefined;
  const createResult = authorityDecision.allowed
    ? dailyBudget?.ok === false
      ? {
          accepted: false,
          runId: provisionalRunId,
          reason: dailyBudget.reason ?? SUNO_BUDGET_EXHAUSTED_REASON,
          urls: [],
          dryRun: config.autopilot.dryRun
        }
      : await connector.create({
          dryRun: config.autopilot.dryRun,
          authority: config.music.suno.authority,
          payload
        })
    : undefined;
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
    urls: input.urls
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
    failedUrls: [],
    reason: "Suno results imported",
    at: importedAt,
    dryRun: config.autopilot.dryRun
  };

  await updateSongState(input.workspaceRoot, input.songId, {
    status: "takes_imported",
    reason: "Suno results imported",
    selectedTakeId: input.selectedTakeId,
    appendPublicLinks: input.urls,
    lastImportOutcome
  });
  await new SunoBrowserWorker(input.workspaceRoot).supersedeImportOutcome(lastImportOutcome);
  emitRuntimeEvent({
    type: "take_imported",
    songId: input.songId,
    paths: input.resultRefs ?? [],
    metadata: [],
    timestamp: Date.now()
  });

  return importedRecord;
}
