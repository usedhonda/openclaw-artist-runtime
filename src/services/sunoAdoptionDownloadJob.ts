import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArtistRuntimeConfig, SunoImportResult } from "../types.js";
import { BrowserWorkerSunoConnector } from "../connectors/suno/browserWorkerConnector.js";
import { appendTakeAttributionAudit, findDryRunImportPaths, findTakeAttributionCollisions } from "./takeAttributionGuard.js";
import { importSunoResults, readLatestSunoRun } from "./sunoRuns.js";
import { appendFailedNotification } from "./failedNotifyLedger.js";
import type { RuntimeEvent } from "./runtimeEventBus.js";

export const DEFAULT_ADOPTION_DOWNLOAD_DELAY_MS = 10 * 60 * 1000;

export interface AdoptionDownloadClient {
  sendMessage(chatId: number, text: string): Promise<unknown>;
}

export interface AdoptionDownloadJobInput {
  root: string;
  songId: string;
  chatId?: number;
  client?: AdoptionDownloadClient;
  config?: Partial<ArtistRuntimeConfig>;
  delayMs?: number;
  now?: number;
}

export type AdoptionDownloadRearmInput = Omit<AdoptionDownloadJobInput, "songId" | "delayMs">;

type AdoptionDownloadJobStatus = "queued" | "imported" | "failed" | "skipped";

interface AdoptionDownloadJobEntry {
  jobId: string;
  songId: string;
  status: AdoptionDownloadJobStatus;
  runId?: string;
  urls?: string[];
  reason?: string;
  createdAt: string;
  scheduledFor?: string;
  completedAt?: string;
}

export interface AdoptionDownloadRearmResult {
  queued: number;
  rearmed: number;
  runNow: number;
}

function jobsPath(root: string): string {
  return join(root, "runtime", "suno-download-jobs.jsonl");
}

async function appendJobEntry(root: string, entry: AdoptionDownloadJobEntry): Promise<void> {
  const path = jobsPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function jobId(songId: string, now: number): string {
  return `adopt_dl_${songId}_${now.toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

async function notifyFailure(input: AdoptionDownloadJobInput, urls: string[], reason: string, runId?: string): Promise<void> {
  if (!input.client || typeof input.chatId !== "number") {
    return;
  }
  const urlText = urls.length > 0 ? `\n${urls.join("\n")}` : "";
  const event: RuntimeEvent = {
    type: "suno_adoption_download_failed",
    songId: input.songId,
    runId,
    urls,
    reason,
    timestamp: input.now ?? Date.now()
  };
  await input.client.sendMessage(
    input.chatId,
    `音源ファイルは取れなかった。Suno URLは有効、ここから聴ける。${urlText}\nreason: ${reason}`
  ).catch((error) => appendFailedNotification(input.root, {
    event,
    chatId: input.chatId!,
    error,
    now: new Date(input.now ?? Date.now())
  }).catch(() => undefined).then(() => undefined));
}

export async function runDownloadAfterAdoptionJob(input: AdoptionDownloadJobInput, existingJobId?: string): Promise<AdoptionDownloadJobEntry> {
  const completedAt = new Date(input.now ?? Date.now()).toISOString();
  const latestRun = await readLatestSunoRun(input.root, input.songId);
  const urls = latestRun?.urls.filter(Boolean) ?? [];
  const runId = latestRun?.runId;
  const id = existingJobId ?? jobId(input.songId, input.now ?? Date.now());
  if (!latestRun || !runId || urls.length === 0) {
    const reason = "adoption_download_missing_suno_url";
    const entry = { jobId: id, songId: input.songId, status: "failed" as const, runId, urls, reason, createdAt: completedAt, completedAt };
    await appendJobEntry(input.root, entry);
    await notifyFailure(input, urls, reason, runId);
    return entry;
  }

  const connector = new BrowserWorkerSunoConnector(input.root, { config: input.config });
  const result: SunoImportResult = await connector.importResults({ runId, urls }).catch((error) => ({
    urls: [],
    paths: [],
    reason: error instanceof Error ? error.message : String(error),
    runId
  }));
  const dryRunPaths = findDryRunImportPaths(result.paths ?? []);
  if (dryRunPaths.length > 0) {
    await appendTakeAttributionAudit(input.root, "dryrun_take_import_blocked", { songId: input.songId, runId, paths: dryRunPaths });
    const reason = "dryrun_take_import_blocked";
    const entry = { jobId: id, songId: input.songId, status: "failed" as const, runId, urls, reason, createdAt: completedAt, completedAt };
    await appendJobEntry(input.root, entry);
    await notifyFailure(input, urls, reason, runId);
    return entry;
  }
  const collisions = await findTakeAttributionCollisions(input.root, input.songId, result.urls);
  if (collisions.length > 0) {
    await appendTakeAttributionAudit(input.root, "take_attribution_collision_blocked", { songId: input.songId, runId, collisions });
    const reason = "take_attribution_collision_blocked";
    const entry = { jobId: id, songId: input.songId, status: "failed" as const, runId, urls, reason, createdAt: completedAt, completedAt };
    await appendJobEntry(input.root, entry);
    await notifyFailure(input, urls, reason, runId);
    return entry;
  }
  if ((result.paths ?? []).length === 0 || result.urls.length === 0) {
    const reason = result.reason ?? "audio_asset_not_found";
    const entry = { jobId: id, songId: input.songId, status: "failed" as const, runId, urls, reason, createdAt: completedAt, completedAt };
    await appendJobEntry(input.root, entry);
    await notifyFailure(input, urls, reason, runId);
    return entry;
  }

  await importSunoResults({
    workspaceRoot: input.root,
    songId: input.songId,
    runId: result.runId ?? runId,
    urls: result.urls,
    selectedTakeId: result.selectedTakeId,
    resultRefs: result.paths ?? [],
    metadata: result.metadata,
    config: input.config,
    preserveSongLifecycle: true
  });
  const entry = { jobId: id, songId: input.songId, status: "imported" as const, runId, urls: result.urls, createdAt: completedAt, completedAt };
  await appendJobEntry(input.root, entry);
  return entry;
}

function armDownloadAfterAdoptionJob(input: AdoptionDownloadJobInput, id: string, delayMs: number): void {
  const timer = setTimeout(() => {
    void runDownloadAfterAdoptionJob(input, id);
  }, delayMs);
  timer.unref?.();
}

export async function scheduleDownloadAfterAdoptionJob(input: AdoptionDownloadJobInput): Promise<AdoptionDownloadJobEntry> {
  const createdAtMs = input.now ?? Date.now();
  const delayMs = input.delayMs ?? DEFAULT_ADOPTION_DOWNLOAD_DELAY_MS;
  const id = jobId(input.songId, createdAtMs);
  const entry = {
    jobId: id,
    songId: input.songId,
    status: "queued" as const,
    createdAt: new Date(createdAtMs).toISOString(),
    scheduledFor: new Date(createdAtMs + delayMs).toISOString()
  };
  await appendJobEntry(input.root, entry);
  armDownloadAfterAdoptionJob(input, id, delayMs);
  return entry;
}

export async function readAdoptionDownloadJobEntries(root: string): Promise<AdoptionDownloadJobEntry[]> {
  const contents = await readFile(jobsPath(root), "utf8").catch(() => "");
  return contents.split("\n").filter(Boolean).map((line) => JSON.parse(line) as AdoptionDownloadJobEntry);
}

export async function rearmQueuedAdoptionDownloadJobs(input: AdoptionDownloadRearmInput): Promise<AdoptionDownloadRearmResult> {
  const latestByJob = new Map<string, AdoptionDownloadJobEntry>();
  for (const entry of await readAdoptionDownloadJobEntries(input.root)) {
    latestByJob.set(entry.jobId, entry);
  }
  const now = input.now ?? Date.now();
  const queued = [...latestByJob.values()].filter((entry) => entry.status === "queued");
  let rearmed = 0;
  let runNow = 0;
  for (const entry of queued) {
    const scheduledAt = entry.scheduledFor ? Date.parse(entry.scheduledFor) : now;
    const delayMs = Math.max(0, Number.isFinite(scheduledAt) ? scheduledAt - now : 0);
    const jobInput = {
      ...input,
      songId: entry.songId,
      now: undefined,
      delayMs: undefined
    };
    if (delayMs === 0) {
      runNow += 1;
      void runDownloadAfterAdoptionJob(jobInput, entry.jobId);
    } else {
      rearmed += 1;
      armDownloadAfterAdoptionJob(jobInput, entry.jobId, delayMs);
    }
  }
  return { queued: queued.length, rearmed, runNow };
}
