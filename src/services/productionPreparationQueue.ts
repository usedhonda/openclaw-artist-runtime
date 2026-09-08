import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateSunoRun } from "./sunoRuns.js";
import { evaluateHumanAssistPending } from "./humanAssistPending.js";
import { readResolvedConfig } from "./runtimeConfig.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

export type ProductionPreparationStatus = "queued" | "started" | "prepared" | "blocked" | "failed";

export interface ProductionPreparationJob {
  id: string;
  status: ProductionPreparationStatus;
  songId: string;
  packVersion: number;
  payloadHash: string;
  contextKey?: string;
  requestedAt: string;
  startedAt?: string;
  startedPid?: number;
  preparedRunId?: string;
  reason?: string;
}

export interface EnqueueProductionPreparationInput {
  songId: string;
  packVersion: number;
  payloadHash: string;
  contextKey?: string;
}

const active = new Map<string, Promise<void>>();
const queueLocks = new Map<string, Promise<unknown>>();

function queuePath(root: string): string { return join(root, "runtime", "suno", "production-preparation-queue.json"); }
function jobId(input: EnqueueProductionPreparationInput): string {
  return createHash("sha256").update(JSON.stringify({ songId: input.songId, packVersion: input.packVersion, payloadHash: input.payloadHash, contextKey: input.contextKey ?? "" })).digest("hex");
}

async function readJobs(root: string): Promise<ProductionPreparationJob[]> {
  const raw = await readFile(queuePath(root), "utf8").catch(() => "[]");
  try { return JSON.parse(raw) as ProductionPreparationJob[]; } catch { throw new Error("production preparation queue is corrupt"); }
}

async function writeJobs(root: string, jobs: ProductionPreparationJob[]): Promise<void> {
  const path = queuePath(root);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function withQueueLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = queueLocks.get(root) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queueLocks.set(root, current);
  try { return await current; } finally { if (queueLocks.get(root) === current) queueLocks.delete(root); }
}

export async function enqueueProductionPreparation(root: string, input: EnqueueProductionPreparationInput): Promise<ProductionPreparationJob> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.songId) || !Number.isInteger(input.packVersion) || input.packVersion < 1 || !/^[a-f0-9]{64}$/.test(input.payloadHash)) throw new Error("invalid production preparation request");
  return withQueueLock(root, async () => {
    const jobs = await readJobs(root);
    const id = jobId(input);
    const existing = jobs.find((job) => job.id === id);
    if (existing) return existing;
    const job: ProductionPreparationJob = { id, status: "queued", songId: input.songId, packVersion: input.packVersion, payloadHash: input.payloadHash, contextKey: input.contextKey, requestedAt: new Date().toISOString() };
    await writeJobs(root, [...jobs, job]);
    return job;
  });
}

async function updateJob(root: string, id: string, patch: Partial<ProductionPreparationJob>): Promise<ProductionPreparationJob | undefined> {
  return withQueueLock(root, async () => {
    const jobs = await readJobs(root);
    const index = jobs.findIndex((job) => job.id === id);
    if (index < 0) return undefined;
    jobs[index] = { ...jobs[index], ...patch };
    await writeJobs(root, jobs);
    return jobs[index];
  });
}

function notify(root: string, job: ProductionPreparationJob, reason: string): void {
  emitRuntimeEvent({ type: "error", source: "production_preparation_queue", reason, songId: job.songId, timestamp: Date.now() });
}

async function runJob(root: string, job: ProductionPreparationJob): Promise<void> {
  try {
    const pending = await evaluateHumanAssistPending(root);
    if (pending) return;
    const config = await readResolvedConfig(root);
    if (config.music.suno.submitMode !== "manual") {
      await updateJob(root, job.id, { status: "blocked", reason: "manual_mode_required" });
      notify(root, job, "production preparation blocked: manual mode required");
      return;
    }
    await updateJob(root, job.id, { status: "started", startedAt: new Date().toISOString(), startedPid: process.pid });
    await generateSunoRun({
      workspaceRoot: root,
      songId: job.songId,
      config,
      expectedPackVersion: job.packVersion,
      expectedPayloadHash: job.payloadHash,
      prepareOnly: true,
      conversational: true,
      conversationKey: job.contextKey,
      onPrepared: async ({ runId }) => { await updateJob(root, job.id, { status: "prepared", preparedRunId: runId }); }
    });
  } catch {
    await updateJob(root, job.id, { status: "failed", reason: "preparation_failed" });
    notify(root, job, "production preparation failed");
  }
}

export async function processProductionPreparationQueue(root: string): Promise<ProductionPreparationJob | undefined> {
  const running = active.get(root);
  if (running) return undefined;
  let release!: () => void;
  const reservation = new Promise<void>((resolve) => { release = resolve; });
  active.set(root, reservation);
  try {
    const jobs = await readJobs(root);
    for (const job of jobs.filter((entry) => entry.status === "started")) {
      await updateJob(root, job.id, { status: "failed", reason: "interrupted_by_restart" });
      notify(root, job, "production preparation failed closed after restart");
    }
    const current = (await readJobs(root)).find((job) => job.status === "queued");
    if (!current) {
      active.delete(root);
      release();
      return undefined;
    }
    void runJob(root, current).catch(async () => {
      await updateJob(root, current.id, { status: "failed", reason: "preparation_failed" }).catch(() => undefined);
      notify(root, current, "production preparation failed");
    }).finally(() => {
      active.delete(root);
      release();
    });
    return current;
  } catch {
    active.delete(root);
    release();
    throw new Error("production preparation queue unavailable");
  }
}

export async function listProductionPreparationJobs(root: string): Promise<ProductionPreparationJob[]> { return readJobs(root); }
