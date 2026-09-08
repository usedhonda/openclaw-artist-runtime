import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtistRuntimeConfig, SunoImportResult, SunoRunRecord } from "../types.js";
import { resolveSunoConnector } from "../connectors/suno/resolveSunoConnector.js";
import { readSongState } from "./artistState.js";
import { readAllSunoRuns, importSunoResults } from "./sunoRuns.js";
import { appendTakeAttributionAudit, findDryRunImportPaths, findTakeAttributionCollisions } from "./takeAttributionGuard.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { readProductionRunBinding, updateProductionRunConversation, type ProductionRunBinding } from "./productionConversation.js";

export const PRODUCTION_TRIAL_INTERVAL_MS = 15_000;
export const PRODUCTION_TRIAL_MAX_AGE_MS = 20 * 60 * 1000;

type ProductionTrialStatus = "pending" | "imported" | "blocked" | "failed";

export interface ProductionTrialJob {
  jobId: string;
  songId: string;
  runId: string;
  urls: string[];
  status: ProductionTrialStatus;
  createdAt: string;
  updatedAt: string;
  urlReadyEmitted?: boolean;
  completedAt?: string;
  reason?: string;
  attempts: number;
}

export interface EnqueueProductionTrialInput {
  songId: string;
  runId: string;
  urls: string[];
}

function jobsDir(root: string): string {
  return join(root, "runtime", "production-trials");
}

function identifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value)) throw new Error(`invalid ${label}`);
}

function jobId(songId: string, runId: string): string {
  return `trial_${songId}_${runId}`;
}

function jobPath(root: string, id: string): string {
  identifier(id, "jobId");
  return join(jobsDir(root), `${id}.json`);
}

async function writeJob(root: string, job: ProductionTrialJob): Promise<void> {
  await mkdir(jobsDir(root), { recursive: true });
  await writeFile(jobPath(root, job.jobId), `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

async function readJobs(root: string): Promise<ProductionTrialJob[]> {
  const entries = await readdir(jobsDir(root)).catch(() => []);
  const jobs = await Promise.all(entries.filter((name) => /^trial_[A-Za-z0-9_-]+\.json$/.test(name)).map(async (name) => {
    try { return JSON.parse(await readFile(join(jobsDir(root), name), "utf8")) as ProductionTrialJob; }
    catch { return undefined; }
  }));
  return jobs.filter((job): job is ProductionTrialJob => Boolean(job));
}

async function acceptedRun(root: string, songId: string, runId: string): Promise<SunoRunRecord | undefined> {
  const runs = await readAllSunoRuns(root, songId);
  return runs.find((run) => run.runId === runId && (run.status === "accepted" || run.status === "imported") && run.urls.length > 0);
}

function exactUrls(expected: string[], actual: string[]): boolean {
  const allowed = new Set(expected);
  return actual.length > 0 && actual.every((url) => allowed.has(url));
}

async function bindingFor(root: string, input: EnqueueProductionTrialInput): Promise<ProductionRunBinding> {
  identifier(input.songId, "songId");
  identifier(input.runId, "runId");
  if (!Array.isArray(input.urls) || input.urls.length === 0 || input.urls.some((url) => typeof url !== "string" || !url.trim())) throw new Error("invalid trial urls");
  await readSongState(root, input.songId);
  const binding = await readProductionRunBinding(root, input.songId, input.runId);
  if (!binding || binding.songId !== input.songId || binding.runId !== input.runId) throw new Error("production run binding not found");
  const run = await acceptedRun(root, input.songId, input.runId);
  if (!run || !exactUrls(run.urls, input.urls)) throw new Error("production run is not accepted with these URLs");
  if (!input.urls.every((url) => run.urls.includes(url))) throw new Error("trial URL is not a member of the accepted run");
  return binding;
}

export async function enqueueProductionTrial(root: string, input: EnqueueProductionTrialInput): Promise<ProductionTrialJob> {
  await bindingFor(root, input);
  const id = jobId(input.songId, input.runId);
  const existing = await readFile(jobPath(root, id), "utf8").then((value) => JSON.parse(value) as ProductionTrialJob).catch(() => undefined);
  if (existing) return existing;
  const now = new Date().toISOString();
  const job: ProductionTrialJob = { jobId: id, songId: input.songId, runId: input.runId, urls: [...input.urls], status: "pending", createdAt: now, updatedAt: now, attempts: 0 };
  await writeJob(root, job);
  emitRuntimeEvent({ type: "suno_take_url_ready", songId: input.songId, runId: input.runId, urls: job.urls, reason: "production_trial_pending_audio", timestamp: Date.now() });
  await writeJob(root, { ...job, urlReadyEmitted: true });
  return { ...job, urlReadyEmitted: true };
}

function transientAudio(reason: string | undefined): boolean {
  const text = (reason ?? "").toLowerCase();
  return !/(login|captcha|payment|quota|attribution|dryrun|dry_run|forbidden|unauthorized|session|auth|challenge)/.test(text);
}

async function processJob(root: string, config: Partial<ArtistRuntimeConfig>, job: ProductionTrialJob): Promise<ProductionTrialJob> {
  if (job.status !== "pending") return job;
  const block = (reason: string): ProductionTrialJob => {
    emitRuntimeEvent({ type: "error", source: "productionTrialWorker", songId: job.songId, reason, timestamp: Date.now() });
    return { ...job, status: "blocked", reason, updatedAt: new Date().toISOString(), attempts: job.attempts + 1 };
  };
  const binding = await readProductionRunBinding(root, job.songId, job.runId);
  if (!binding) return block("production_run_binding_missing");
  if (Date.now() - Date.parse(job.createdAt) > PRODUCTION_TRIAL_MAX_AGE_MS) return block("production_trial_audio_timeout");
  const connector = resolveSunoConnector(root, config);
  const result: SunoImportResult = await connector.importResults({ runId: job.runId, urls: job.urls }).catch((error) => ({ urls: [], paths: [], runId: job.runId, reason: error instanceof Error ? error.message : String(error) }));
  const dryRunPaths = findDryRunImportPaths(result.paths ?? []);
  const collisions = result.urls.length > 0 ? await findTakeAttributionCollisions(root, job.songId, result.urls) : [];
  if (dryRunPaths.length > 0 || collisions.length > 0) {
    const reason = dryRunPaths.length > 0 ? "dryrun_take_import_blocked" : "take_attribution_collision_blocked";
    await appendTakeAttributionAudit(root, reason, { songId: job.songId, runId: job.runId, urls: job.urls });
    return block(reason);
  }
  if ((result.paths ?? []).length === 0 || result.urls.length === 0) {
    const reason = result.reason ?? "audio_asset_not_found";
    return { ...job, status: transientAudio(reason) ? "pending" : "blocked", reason, updatedAt: new Date().toISOString(), attempts: job.attempts + 1 };
  }
  if ((result.runId && result.runId !== job.runId) || !exactUrls(job.urls, result.urls)) return block("import_result_run_or_url_mismatch");
  await importSunoResults({ workspaceRoot: root, songId: job.songId, runId: job.runId, urls: result.urls, resultRefs: result.paths ?? [], metadata: result.metadata, config, preserveSongLifecycle: true });
  await updateProductionRunConversation(root, binding, "submitted");
  const completedAt = new Date().toISOString();
  emitRuntimeEvent({ type: "song_take_completed", songId: job.songId, urls: result.urls, timestamp: Date.now() });
  return { ...job, status: "imported", updatedAt: completedAt, completedAt, attempts: job.attempts + 1, reason: "audio_imported" };
}

export async function processPendingProductionTrials(root: string, config: Partial<ArtistRuntimeConfig>): Promise<ProductionTrialJob[]> {
  const results: ProductionTrialJob[] = [];
  for (const job of await readJobs(root)) {
    if (job.status !== "pending") continue;
    const next = await processJob(root, config, job);
    await writeJob(root, next);
    results.push(next);
  }
  return results;
}

export function startProductionTrialWorker(root: string, config: Partial<ArtistRuntimeConfig>): () => void {
  const timer = setInterval(() => { void processPendingProductionTrials(root, config); }, PRODUCTION_TRIAL_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
