import { appendFile, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createSongIdea } from "../src/services/songIdeation";
import { importSunoResults } from "../src/services/sunoRuns";
import { recordProductionRunBinding } from "../src/services/productionConversation";
import { enqueueProductionTrial, processPendingProductionTrials } from "../src/services/productionTrialWorker";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";

const importResults = vi.fn();
vi.mock("../src/connectors/suno/resolveSunoConnector", () => ({
  resolveSunoConnector: () => ({ status: vi.fn(), create: vi.fn(), importResults })
}));

async function seed(root: string, runId = "run-trial", urls = ["https://suno.com/song/take-a"]): Promise<void> {
  await ensureArtistWorkspace(root);
  await createSongIdea({ workspaceRoot: root, title: "Trial Song", artistReason: "test" });
  await importSunoResults({ workspaceRoot: root, songId: "song-001", runId, urls });
  await recordProductionRunBinding(root, {
    songId: "song-001", runId, packVersion: 1, payloadHash: "hash", baselineStatus: "take_selected", createdAt: new Date().toISOString()
  });
}

describe("production trial worker", () => {
  beforeEach(() => {
    importResults.mockReset();
    getRuntimeEventBus().clearForTest();
  });

  it("keeps a pending trial until audio exists, then imports exact run once", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-production-trial-"));
    await seed(root);
    const urls = ["https://suno.com/song/take-a"];
    const job = await enqueueProductionTrial(root, { songId: "song-001", runId: "run-trial", urls });
    expect(job.status).toBe("pending");
    importResults.mockResolvedValueOnce({ runId: "run-trial", urls: [], paths: [], reason: "network timeout secret-token=hidden" });
    expect((await processPendingProductionTrials(root, {}))[0]?.status).toBe("pending");
    expect(JSON.parse(await readFile(join(root, "runtime/production-trials/trial_song-001_run-trial.json"), "utf8")).reason).toBe("production_trial_audio_pending");
    expect(await readFile(join(root, "runtime/production-trials/trial_song-001_run-trial.json"), "utf8")).not.toContain("secret-token");
    const audioPath = join(root, "runtime", "take-a.mp3");
    await writeFile(audioPath, "audio", "utf8");
    importResults.mockResolvedValueOnce({ runId: "run-trial", urls, paths: [audioPath], metadata: [] });
    expect((await processPendingProductionTrials(root, {}))[0]).toMatchObject({ status: "imported", runId: "run-trial" });
    expect((await processPendingProductionTrials(root, {})).length).toBe(0);
    expect(JSON.parse(await readFile(join(root, "runtime/production-trials/trial_song-001_run-trial.json"), "utf8")).status).toBe("imported");
  });

  it("rejects wrong run or cross-song URLs before enqueue", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-production-trial-invalid-"));
    await seed(root);
    await expect(enqueueProductionTrial(root, { songId: "song-001", runId: "run-trial", urls: ["https://suno.com/song/other"] })).rejects.toThrow();
    await expect(enqueueProductionTrial(root, { songId: "other-song", runId: "run-trial", urls: ["https://suno.com/song/take-a"] })).rejects.toThrow();
  });

  it("rejects enqueue after a latest failed correction for the same run", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-production-trial-correction-"));
    await seed(root);
    await appendFile(join(root, "songs/song-001/suno/runs.jsonl"), `${JSON.stringify({ runId: "run-trial", songId: "song-001", createdAt: new Date(Date.now() + 1000).toISOString(), status: "failed", urls: [], dryRun: false })}\n`);
    await expect(enqueueProductionTrial(root, { songId: "song-001", runId: "run-trial", urls: ["https://suno.com/song/take-a"] })).rejects.toThrow("not accepted");
  });

  it("uses append order when accepted and failed corrections share a timestamp", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-production-trial-equal-timestamp-"));
    await seed(root);
    const runsPath = join(root, "songs/song-001/suno/runs.jsonl");
    const raw = await readFile(runsPath, "utf8");
    const accepted = raw.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>).find((entry) => entry.runId === "run-trial")!;
    const sameTime = accepted.createdAt;
    await writeFile(runsPath, `${JSON.stringify({ ...accepted, createdAt: sameTime, status: "accepted", urls: ["https://suno.com/song/take-a"] })}\n${JSON.stringify({ ...accepted, createdAt: sameTime, status: "failed", urls: [] })}\n`, "utf8");
    await expect(enqueueProductionTrial(root, { songId: "song-001", runId: "run-trial", urls: ["https://suno.com/song/take-a"] })).rejects.toThrow("not accepted");
  });

  it("blocks login failures with one safe actionable event", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-production-trial-blocked-"));
    await seed(root);
    await enqueueProductionTrial(root, { songId: "song-001", runId: "run-trial", urls: ["https://suno.com/song/take-a"] });
    importResults.mockResolvedValueOnce({ runId: "run-trial", urls: [], paths: [], reason: "login_required" });
    const events: unknown[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => { if (event.type === "error") events.push(event); });
    expect((await processPendingProductionTrials(root, {}))[0]?.status).toBe("blocked");
    unsubscribe();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain("login_required");
  });

  it("serializes concurrent ticks and resumes the persisted pending job", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-production-trial-concurrent-"));
    await seed(root);
    await enqueueProductionTrial(root, { songId: "song-001", runId: "run-trial", urls: ["https://suno.com/song/take-a"] });
    const audioPath = join(root, "runtime", "take-a.mp3");
    await writeFile(audioPath, "audio", "utf8");
    importResults.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { runId: "run-trial", urls: ["https://suno.com/song/take-a"], paths: [audioPath], metadata: [] };
    });
    const results = await Promise.all([processPendingProductionTrials(root, {}), processPendingProductionTrials(root, {})]);
    expect(importResults).toHaveBeenCalledTimes(1);
    expect(results.flat().filter((job) => job.status === "imported")).toHaveLength(1);
    expect((await processPendingProductionTrials(root, {})).length).toBe(0);
  });
});
