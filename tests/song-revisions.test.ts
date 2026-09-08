import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { saveLyricRevision, restoreLyricRevision, listSongMaterialVersions } from "../src/services/songRevisions";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artist-revisions-"));
  await mkdir(join(root, "songs", "spawn_78934e", "lyrics"), { recursive: true });
  await writeFile(join(root, "songs", "spawn_78934e", "song.md"), "# Equal Cancellation\n\nStatus: archived\n");
  await writeFile(join(root, "songs", "spawn_78934e", "lyrics", "lyrics.v1.md"), "[Verse 1]\nold line\n\n[Hook]\nkeep this\n\n");
  return root;
}

describe("song-bound lyric revisions", () => {
  it("stores a partial candidate without changing adopted material", async () => {
    const root = await fixture();
    const candidate = await saveLyricRevision({
      workspaceRoot: root, songId: "spawn_78934e", instruction: "rewrite verse", changes: [{ section: "Verse 1", before: "old line", after: "new line" }]
    });
    expect(candidate.version).toBe(1);
    expect(candidate.text).toContain("keep this");
    expect(await readFile(join(root, "songs", "spawn_78934e", "lyrics", "lyrics.v1.md"), "utf8")).toContain("old line");
    expect((await listSongMaterialVersions(root, "spawn_78934e")).map((entry) => `${entry.kind}:${entry.version}`)).toEqual(["adopted_lyrics:1", "candidate:1"]);
  });

  it("requires exact text and restores into a new candidate", async () => {
    const root = await fixture();
    const first = await saveLyricRevision({ workspaceRoot: root, songId: "spawn_78934e", instruction: "draft", text: "first" });
    await expect(saveLyricRevision({ workspaceRoot: root, songId: "spawn_78934e", instruction: "stale", text: "bad", expectedSourceText: "wrong" })).rejects.toThrow("exact-text");
    const restored = await restoreLyricRevision({ workspaceRoot: root, songId: "spawn_78934e", version: first.version, instruction: "restore", expectedText: first.text });
    expect(restored.version).toBe(2);
    expect(await readFile(join(root, "songs", "spawn_78934e", "lyrics", "revisions", "candidate.v1.json"), "utf8")).toContain('"version": 1');
  });
});
