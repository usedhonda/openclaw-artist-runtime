import { appendFile, readFile, unlink } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createSongIdea } from "../src/services/songIdeation";
import { importSunoResults } from "../src/services/sunoRuns";
import { listSongTakes, selectTake } from "../src/services/takeSelection";
import { readSongMaterial } from "../src/services/songMaterialReader";

describe("historical Suno take selection", () => {
  it("adopts an earlier run with its own URLs and exposes all runs", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-history-"));
    await ensureArtistWorkspace(root);
    await createSongIdea({ workspaceRoot: root, title: "History Song", artistReason: "test" });
    await importSunoResults({
      workspaceRoot: root,
      songId: "song-001",
      runId: "run-old",
      urls: ["https://example.com/old-a", "https://example.com/old-b"]
    });
    await importSunoResults({
      workspaceRoot: root,
      songId: "song-001",
      runId: "run-new",
      urls: ["https://example.com/new-a", "https://example.com/new-b"]
    });

    const takes = await listSongTakes(root, "song-001");
    expect(takes.filter((take) => take.runId === "run-old").map((take) => take.url)).toEqual([
      "https://example.com/old-a",
      "https://example.com/old-b"
    ]);

    const selection = await selectTake({
      workspaceRoot: root,
      songId: "song-001",
      runId: "run-old",
      selectedTakeId: "old-b",
      reason: "producer comparison",
      conversational: true
    });
    expect(selection.runId).toBe("run-old");
    expect(selection.sourceUrls).toEqual(["https://example.com/old-a", "https://example.com/old-b"]);
    expect(JSON.parse(await readFile(join(root, "songs/song-001/suno/latest-results.json"), "utf8")).urls).toEqual([
      "https://example.com/new-a",
      "https://example.com/new-b"
    ]);

    const material = await readSongMaterial(root, "song-001");
    expect(material.priorRuns.map((run) => run.runId)).toEqual(expect.arrayContaining(["run-old", "run-new"]));
    expect(material.selectedTakeReferences[0]?.runId).toBe("run-old");
  });

  it("rejects a take that is not recorded for the requested song/run", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-history-invalid-"));
    await ensureArtistWorkspace(root);
    await createSongIdea({ workspaceRoot: root, title: "History Song", artistReason: "test" });
    await importSunoResults({
      workspaceRoot: root,
      songId: "song-001",
      runId: "run-only",
      urls: ["https://example.com/real-a"]
    });
    await expect(selectTake({
      workspaceRoot: root,
      songId: "song-001",
      runId: "run-only",
      selectedTakeId: "fabricated-from-other-song"
    })).rejects.toThrow("not recorded");
  });

  it("moves the current reference back when the producer re-adopts an earlier take", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-history-re-adopt-"));
    await ensureArtistWorkspace(root);
    await createSongIdea({ workspaceRoot: root, title: "History Song", artistReason: "test" });
    for (const [runId, url] of [["run-a", "https://example.com/a"], ["run-b", "https://example.com/b"]]) {
      await importSunoResults({ workspaceRoot: root, songId: "song-001", runId, urls: [url] });
    }
    await selectTake({ workspaceRoot: root, songId: "song-001", runId: "run-a", selectedTakeId: "a", producerDecision: true });
    await selectTake({ workspaceRoot: root, songId: "song-001", runId: "run-b", selectedTakeId: "b", producerDecision: true });
    const adopted = await selectTake({ workspaceRoot: root, songId: "song-001", runId: "run-a", selectedTakeId: "a", producerDecision: true });
    expect(adopted.runId).toBe("run-a");
    expect(JSON.parse(await readFile(join(root, "songs/song-001/suno/selected-take.json"), "utf8"))).toMatchObject({ runId: "run-a", selectedTakeId: "a" });
  });

  it("can select a persisted historical run when latest-results is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-history-no-latest-"));
    await ensureArtistWorkspace(root);
    await createSongIdea({ workspaceRoot: root, title: "History Song", artistReason: "test" });
    await importSunoResults({ workspaceRoot: root, songId: "song-001", runId: "run-old", urls: ["https://example.com/old"] });
    await unlink(join(root, "songs/song-001/suno/latest-results.json"));
    await expect(selectTake({ workspaceRoot: root, songId: "song-001", runId: "run-old", selectedTakeId: "old", producerDecision: true })).resolves.toMatchObject({ runId: "run-old" });
  });

  it("does not revive a run hidden by a newer failed correction", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-history-failed-correction-"));
    await ensureArtistWorkspace(root);
    await createSongIdea({ workspaceRoot: root, title: "History Song", artistReason: "test" });
    await importSunoResults({ workspaceRoot: root, songId: "song-001", runId: "run-corrected", urls: ["https://example.com/old"] });
    await appendFile(join(root, "songs/song-001/suno/runs.jsonl"), `${JSON.stringify({ runId: "run-corrected", songId: "song-001", createdAt: new Date(Date.now() + 1000).toISOString(), mode: "cli", authorityDecision: { allowed: false, reason: "corrected", policyDecision: "failed" }, status: "failed", dryRun: false, urls: [] })}\n`);
    expect(await listSongTakes(root, "song-001")).toEqual([]);
  });

  it("rejects an equal-timestamp failed correction by append order", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-take-history-equal-time-"));
    await ensureArtistWorkspace(root);
    await createSongIdea({ workspaceRoot: root, title: "History Song", artistReason: "test" });
    await importSunoResults({ workspaceRoot: root, songId: "song-001", runId: "run-same-time", urls: ["https://example.com/take"] });
    const runsPath = join(root, "songs/song-001/suno/runs.jsonl");
    const lines = (await readFile(runsPath, "utf8")).trim().split("\n");
    const accepted = JSON.parse(lines[0]!) as { createdAt: string };
    await appendFile(runsPath, `${JSON.stringify({ runId: "run-same-time", songId: "song-001", createdAt: accepted.createdAt, status: "failed", urls: [], dryRun: false })}\n`);
    await expect(selectTake({ workspaceRoot: root, songId: "song-001", runId: "run-same-time", selectedTakeId: "take", producerDecision: true })).rejects.toThrow("unknown Suno run");
  });
});
