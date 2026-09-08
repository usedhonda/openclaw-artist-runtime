import { readFile } from "node:fs/promises";
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
});
