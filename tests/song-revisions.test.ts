import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { adoptLyricRevision, saveLyricRevision, restoreLyricRevision, listSongMaterialVersions } from "../src/services/songRevisions";
import { readSongState } from "../src/services/artistState";
import { registerSunoTools } from "../src/tools/sunoTools";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artist-revisions-"));
  await mkdir(join(root, "songs", "fixture-song", "lyrics"), { recursive: true });
  await writeFile(join(root, "songs", "fixture-song", "song.md"), "# Fixture Song\n\nStatus: archived\n");
  await writeFile(join(root, "songs", "fixture-song", "lyrics", "lyrics.v1.md"), "[Verse 1]\nold line\n\n[Hook]\nkeep this\n\n");
  return root;
}

describe("song-bound lyric revisions", () => {
  it("stores a partial candidate without changing adopted material", async () => {
    const root = await fixture();
    const candidate = await saveLyricRevision({
      workspaceRoot: root, songId: "fixture-song", instruction: "rewrite verse", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: hash("[Verse 1]\nold line\n\n[Hook]\nkeep this"), changes: [{ section: "Verse 1", before: "old line", after: "new line" }]
    });
    expect(candidate.version).toBe(1);
    expect(candidate.text).toContain("keep this");
    expect(await readFile(join(root, "songs", "fixture-song", "lyrics", "lyrics.v1.md"), "utf8")).toContain("old line");
    expect((await listSongMaterialVersions(root, "fixture-song")).map((entry) => `${entry.kind}:${entry.version}`)).toEqual(["adopted_lyrics:1", "candidate:1"]);
  });

  it("requires exact text and restores into a new candidate", async () => {
    const root = await fixture();
    const source = "[Verse 1]\nold line\n\n[Hook]\nkeep this";
    const first = await saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "draft", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: hash(source), text: "first" });
    await expect(saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "stale", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: "wrong", text: "bad" })).rejects.toThrow("hash");
    const restored = await restoreLyricRevision({ workspaceRoot: root, songId: "fixture-song", version: first.version, instruction: "restore", expectedText: first.text, kind: "candidate" });
    expect(restored.version).toBe(2);
    expect(await readFile(join(root, "songs", "fixture-song", "lyrics", "revisions", "candidate.v1.json"), "utf8")).toContain('"version": 1');
  });

  it("chains candidates and restores one section onto the current candidate", async () => {
    const root = await fixture();
    const source = "[Verse 1]\nold line\n\n[Hook]\nkeep this";
    const first = await saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "first pass", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: hash(source), changes: [{ section: "Verse 1", before: "old line", after: "new line" }] });
    const second = await saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "stronger pass", source: { kind: "candidate", version: first.version }, expectedSourceHash: first.textHash, changes: [{ section: "Verse 1", before: "new line", after: "aggressive line" }] });
    const restored = await restoreLyricRevision({ workspaceRoot: root, songId: "fixture-song", version: first.version, kind: "candidate", targetVersion: second.version, targetKind: "candidate", instruction: "restore first verse", changes: [{ section: "Verse 1", before: "aggressive line", after: "new line" }], expectedText: first.text });
    expect(restored.text).toContain("new line");
    expect(restored.text).toContain("keep this");
    expect(restored.source).toEqual({ kind: "candidate", version: second.version });
  });

  it("pins every registered Suno generate call to the approved payload", () => {
    const registrations: Array<(context: { workspaceDir?: string }) => { name: string; parameters: Record<string, unknown> }> = [];
    registerSunoTools({ registerTool: (tool: unknown) => registrations.push(tool as typeof registrations[number]) });
    const generate = registrations.find((registration) => registration({}).name === "artist_suno_generate")!({});
    expect(generate.parameters.required).toEqual(["songId", "expectedPayloadHash", "expectedPackVersion"]);
  });

  it("keeps an archived song archived when an approved candidate fails validation", async () => {
    const root = await fixture();
    const text = `[Verse 1]\n${"あ".repeat(12000)}`;
    const candidate = await saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "oversized", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: hash("[Verse 1]\nold line\n\n[Hook]\nkeep this"), text });
    await expect(adoptLyricRevision({ workspaceRoot: root, songId: "fixture-song", version: candidate.version, artistReason: "approved", expectedTextHash: candidate.textHash })).rejects.toThrow();
    expect((await readSongState(root, "fixture-song")).status).toBe("archived");
  });
});
