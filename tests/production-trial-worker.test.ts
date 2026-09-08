import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createSongIdea } from "../src/services/songIdeation";
import { importSunoResults } from "../src/services/sunoRuns";
import { recordProductionRunBinding } from "../src/services/productionConversation";
import { enqueueProductionTrial, processPendingProductionTrials } from "../src/services/productionTrialWorker";

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
  it("keeps a pending trial until audio exists, then imports exact run once", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-production-trial-"));
    await seed(root);
    const urls = ["https://suno.com/song/take-a"];
    const job = await enqueueProductionTrial(root, { songId: "song-001", runId: "run-trial", urls });
    expect(job.status).toBe("pending");
    importResults.mockResolvedValueOnce({ runId: "run-trial", urls: [], paths: [], reason: "audio_pending" });
    expect((await processPendingProductionTrials(root, {}))[0]?.status).toBe("pending");
    importResults.mockResolvedValueOnce({ runId: "run-trial", urls, paths: ["/tmp/take-a.mp3"], metadata: [] });
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
});
