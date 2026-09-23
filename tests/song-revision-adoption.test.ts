import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createPack = vi.hoisted(() => vi.fn());
vi.mock("../src/services/sunoPromptPackFiles.js", () => ({ createAndPersistSunoPromptPack: createPack }));

import { adoptLyricRevision, saveLyricRevision } from "../src/services/songRevisions";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("lyric adoption receipt", () => {
  beforeEach(() => {
    createPack.mockReset();
    createPack.mockImplementation(async () => ({ songId: "fixture-song", packVersion: createPack.mock.calls.length + 1, pack: { payloadHash: "payload" }, artifactPaths: {}, ledgerEntryIds: [] }));
  });

  it("is idempotent and single-flight for the same approved candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-adopt-"));
    const text = "[Verse 1]\nline";
    await mkdir(join(root, "songs", "fixture-song", "lyrics"), { recursive: true });
    await writeFile(join(root, "songs", "fixture-song", "song.md"), "# Fixture Song\n\nStatus: archived\n");
    await writeFile(join(root, "songs", "fixture-song", "lyrics", "lyrics.v1.md"), `${text}\n`);
    const candidate = await saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "approved", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: hash(text), text });
    const input = { workspaceRoot: root, songId: "fixture-song", version: candidate.version, artistReason: "approved", expectedTextHash: candidate.textHash };
    const [first, second] = await Promise.all([adoptLyricRevision(input), adoptLyricRevision(input)]);
    expect(createPack).toHaveBeenCalledTimes(1);
    expect(first.promptPack.packVersion).toBe(second.promptPack.packVersion);
  });

  it("serializes different candidates for one song", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-adopt-"));
    const text = "[Verse 1]\nline";
    await mkdir(join(root, "songs", "fixture-song", "lyrics"), { recursive: true });
    await writeFile(join(root, "songs", "fixture-song", "song.md"), "# Fixture Song\n\nStatus: archived\n");
    await writeFile(join(root, "songs", "fixture-song", "lyrics", "lyrics.v1.md"), `${text}\n`);
    const first = await saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "one", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: hash(text), text: "one" });
    const second = await saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "two", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: hash(text), text: "two" });
    const third = await saveLyricRevision({ workspaceRoot: root, songId: "fixture-song", instruction: "three", source: { kind: "adopted_lyrics", version: 1 }, expectedSourceHash: hash(text), text: "three" });
    let active = 0;
    let maximum = 0;
    let calls = 0;
    const gates = [0, 0, 0].map(() => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => { release = resolve; });
      return { promise, release };
    });
    createPack.mockImplementation(async () => {
      const index = calls++;
      active += 1;
      maximum = Math.max(maximum, active);
      await gates[index]!.promise;
      active -= 1;
      return { songId: "fixture-song", packVersion: index + 10, pack: { payloadHash: `payload-${index}` }, artifactPaths: {}, ledgerEntryIds: [] };
    });
    const firstAdoption = adoptLyricRevision({ workspaceRoot: root, songId: "fixture-song", version: first.version, artistReason: "one", expectedTextHash: first.textHash });
    await vi.waitFor(() => expect(createPack).toHaveBeenCalledTimes(1));
    const secondAdoption = adoptLyricRevision({ workspaceRoot: root, songId: "fixture-song", version: second.version, artistReason: "two", expectedTextHash: second.textHash });
    gates[0]!.release();
    await vi.waitFor(() => expect(createPack).toHaveBeenCalledTimes(2));
    const thirdAdoption = adoptLyricRevision({ workspaceRoot: root, songId: "fixture-song", version: third.version, artistReason: "three", expectedTextHash: third.textHash });
    gates[1]!.release();
    await vi.waitFor(() => expect(createPack).toHaveBeenCalledTimes(3));
    gates[2]!.release();
    const results = await Promise.all([firstAdoption, secondAdoption, thirdAdoption]);
    expect(maximum).toBe(1);
    expect(results.map((result) => result.promptPack.packVersion)).toEqual([10, 11, 12]);
  });
});
