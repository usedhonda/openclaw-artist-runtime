import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const { generate, pending, config } = vi.hoisted(() => ({ generate: vi.fn(), pending: vi.fn(async () => undefined), config: vi.fn(async () => ({ music: { suno: { submitMode: "manual" } } })) }));
vi.mock("../src/services/sunoRuns", () => ({ generateSunoRun: generate }));
vi.mock("../src/services/humanAssistPending", () => ({ evaluateHumanAssistPending: pending }));
vi.mock("../src/services/runtimeConfig", () => ({ readResolvedConfig: config }));

import { enqueueProductionPreparation, listProductionPreparationJobs, processProductionPreparationQueue } from "../src/services/productionPreparationQueue";

const payloadHash = "a".repeat(64);

describe("production preparation queue", () => {
  it("persists an idempotent exact request and rejects stale-shaped inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "production-preparation-"));
    const first = await enqueueProductionPreparation(root, { songId: "song-1", packVersion: 3, payloadHash, contextKey: "ctx" });
    const replay = await enqueueProductionPreparation(root, { songId: "song-1", packVersion: 3, payloadHash, contextKey: "ctx" });
    expect(replay).toEqual(first);
    await expect(enqueueProductionPreparation(root, { songId: "song-1", packVersion: 0, payloadHash })).rejects.toThrow("invalid");
  });

  it("leaves queued while another manual assist is active", async () => {
    const root = await mkdtemp(join(tmpdir(), "production-preparation-busy-"));
    pending.mockResolvedValueOnce({ songId: "other-song" });
    const job = await enqueueProductionPreparation(root, { songId: "song-2", packVersion: 1, payloadHash });
    await processProductionPreparationQueue(root);
    expect((await listProductionPreparationJobs(root)).find((entry) => entry.id === job.id)?.status).toBe("queued");
    expect(generate).not.toHaveBeenCalled();
  });

  it("starts one exact request and marks prepared from the callback", async () => {
    const root = await mkdtemp(join(tmpdir(), "production-preparation-start-"));
    let resolveRun!: () => void;
    generate.mockImplementationOnce(async (input: { onPrepared: (value: { runId: string }) => Promise<void> }) => {
      await input.onPrepared({ runId: "run-1" });
      await new Promise<void>((resolve) => { resolveRun = resolve; });
    });
    const job = await enqueueProductionPreparation(root, { songId: "song-3", packVersion: 2, payloadHash });
    await processProductionPreparationQueue(root);
    await vi.waitFor(async () => expect((await listProductionPreparationJobs(root)).find((entry) => entry.id === job.id)?.status).toBe("prepared"));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toMatchObject({ songId: "song-3", expectedPackVersion: 2, expectedPayloadHash: payloadHash, prepareOnly: true, conversational: true });
    await processProductionPreparationQueue(root);
    expect(generate).toHaveBeenCalledTimes(1);
    resolveRun();
  });

  it("blocks non-manual mode and fail-closes interrupted started jobs", async () => {
    const root = await mkdtemp(join(tmpdir(), "production-preparation-blocked-"));
    config.mockResolvedValueOnce({ music: { suno: { submitMode: "live" } } });
    const blocked = await enqueueProductionPreparation(root, { songId: "song-4", packVersion: 1, payloadHash });
    await processProductionPreparationQueue(root);
    await vi.waitFor(async () => expect((await listProductionPreparationJobs(root)).find((entry) => entry.id === blocked.id)?.status).toBe("blocked"));
    const interrupted = await enqueueProductionPreparation(root, { songId: "song-5", packVersion: 1, payloadHash: "b".repeat(64) });
    const jobs = await listProductionPreparationJobs(root);
    await (await import("node:fs/promises")).writeFile(join(root, "runtime/suno/production-preparation-queue.json"), `${JSON.stringify(jobs.map((entry) => entry.id === interrupted.id ? { ...entry, status: "started", startedPid: 123 } : entry))}\n`);
    await processProductionPreparationQueue(root);
    expect((await listProductionPreparationJobs(root)).find((entry) => entry.id === interrupted.id)?.status).toBe("failed");
  });
});
