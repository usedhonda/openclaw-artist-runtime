import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { buildSunoArtifactIndex, generateSunoRun, importSunoResults } from "../src/services/sunoRuns";

async function prepareRun(root: string) {
  await ensureArtistWorkspace(root);
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId: "song-001",
    songTitle: "Runtime Dust",
    artistReason: "artifact index",
    lyricsText: "broken meters still glow",
    knowledgePackVersion: "test-pack"
  });
  const run = await generateSunoRun({
    workspaceRoot: root,
    songId: "song-001"
  });
  await importSunoResults({
    workspaceRoot: root,
    songId: "song-001",
    runId: run.runId,
    urls: ["https://suno.com/song/indexed"]
  });
  return run.runId;
}

describe("Suno runtime artifact index", () => {
  it("indexes mp3 and m4a files with run and song linkage", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-artifact-index-"));
    const runId = await prepareRun(root);
    await mkdir(join(root, "runtime", "suno", runId), { recursive: true });
    await writeFile(join(root, "runtime", "suno", runId, "track-a.mp3"), "mp3-bytes", "utf8");
    await writeFile(join(root, "runtime", "suno", runId, "track-b.m4a"), "m4a-bytes", "utf8");
    await writeFile(join(root, "runtime", "suno", runId, "notes.txt"), "ignore me", "utf8");

    const index = await buildSunoArtifactIndex(root);

    expect(index).toHaveLength(2);
    expect(index.map((entry) => entry.format).sort()).toEqual(["m4a", "mp3"]);
    expect(index.every((entry) => entry.runId === runId)).toBe(true);
    expect(index.every((entry) => entry.songId === "song-001")).toBe(true);
    expect(index.every((entry) => entry.size > 0)).toBe(true);
  });

  it("returns an empty artifact index when runtime/suno is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-artifact-index-empty-"));

    await expect(buildSunoArtifactIndex(root)).resolves.toEqual([]);
  });
});
