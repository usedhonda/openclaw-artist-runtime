import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { readSongState, updateSongState } from "../src/services/artistState";
import { reviseSongProduction } from "../src/services/songProductionRevisions";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artist-production-revision-"));
  await mkdir(join(root, "songs", "fixture-song", "lyrics"), { recursive: true });
  await writeFile(join(root, "songs", "fixture-song", "song.md"), "# Fixture Song\n\nStatus: take_selected\n");
  const lyrics = "[Verse 1]\nold line\n\n[Hook]\nkeep this";
  await writeFile(join(root, "songs", "fixture-song", "lyrics", "lyrics.v1.md"), `${lyrics}\n`);
  await updateSongState(root, "fixture-song", { status: "take_selected", selectedTakeId: "take-old", title: "Fixture Song" });
  const base = await createAndPersistSunoPromptPack({ workspaceRoot: root, songId: "fixture-song", songTitle: "Fixture Song", artistReason: "nu-jazz rap", lyricsText: lyrics, bpm: 92, tempoBand: "mid", preserveSongStatus: true });
  return { root, lyrics, base };
}

describe("bounded song production revisions", () => {
  it("creates an immutable production revision with coherent BPM and direction", async () => {
    const { root, lyrics, base } = await fixture();
    const oldSnapshot = await readFile(join(root, "songs/fixture-song/prompts/prompt-pack-v001/suno-payload.json"), "utf8");
    const oldLyrics = await readFile(join(root, "songs/fixture-song/lyrics/lyrics.v1.md"), "utf8");
    const revision = await reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: base.packVersion, expectedBasePayloadHash: base.pack.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "make the arrangement faster and more severe", patch: { title: "Faster Fixture", bpm: 148, direction: "tight breakbeat drums, clipped bass stabs", excludeStyles: ["acoustic ballad", "festival EDM drop"] } });
    expect(revision.origin).toBe("producer_revision");
    expect(revision.effective.bpm).toBe(148);
    expect(revision.promptPack.pack.style).toContain("tight breakbeat drums");
    expect(revision.promptPack.pack.exclude).toBe("acoustic ballad, festival EDM drop");
    expect(revision.promptPack.pack.payload.songName).toBe("Faster Fixture");
    expect(revision.promptPack.pack.payload.payloadYaml).toContain("tempo: 148");
    expect(revision.promptPack.pack.promptHash).toBe(hash(`${revision.promptPack.pack.style}\n${revision.promptPack.pack.exclude}\n${revision.promptPack.pack.yamlLyrics}`));
    expect(revision.promptPack.pack.payloadHash).toBe(hash(JSON.stringify(revision.promptPack.pack.payload)));
    expect(await readFile(join(root, "songs/fixture-song/prompts/prompt-pack-v001/suno-payload.json"), "utf8")).toBe(oldSnapshot);
    expect(await readFile(join(root, "songs/fixture-song/lyrics/lyrics.v1.md"), "utf8")).toBe(oldLyrics);
    expect((await readSongState(root, "fixture-song")).selectedTakeId).toBe("take-old");
    expect((await readSongState(root, "fixture-song")).status).toBe("take_selected");
  });

  it("replays exactly and rejects a stale changed request", async () => {
    const { root, lyrics, base } = await fixture();
    const input = { workspaceRoot: root, songId: "fixture-song", basePackVersion: base.packVersion, expectedBasePayloadHash: base.pack.payloadHash, lyric: { kind: "adopted_lyrics" as const, version: 1, hash: hash(lyrics) }, producerInstruction: "same", patch: { bpm: 120 } };
    const first = await reviseSongProduction(input);
    const replay = await reviseSongProduction(input);
    expect(replay.revisionId).toBe(first.revisionId);
    await expect(reviseSongProduction({ ...input, producerInstruction: "different" })).rejects.toThrow("stale");
  });

  it("inherits immutable production fields for title/BPM-only changes and carries direction forward", async () => {
    const { root, lyrics, base } = await fixture();
    const title = await reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: 1, expectedBasePayloadHash: base.pack.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "title", patch: { title: "New Title" } });
    expect(title.promptPack.pack.style).toBe(base.pack.style);
    expect(title.promptPack.pack.exclude).toBe(base.pack.exclude);
    expect(title.promptPack.pack.sliders).toEqual(base.pack.sliders);
    const bpm = await reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: title.packVersion, expectedBasePayloadHash: title.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "tempo", patch: { bpm: 140 } });
    expect(bpm.promptPack.pack.style).toContain("140 BPM");
    expect(bpm.promptPack.pack.style.replace("140 BPM", "92 BPM")).toBe(title.promptPack.pack.style);
    const directed = await reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: bpm.packVersion, expectedBasePayloadHash: bpm.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "direction", patch: { direction: "dry clipped drums" } });
    const inherited = await reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: directed.packVersion, expectedBasePayloadHash: directed.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "keep direction" });
    expect(inherited.promptPack.pack.style).toContain("dry clipped drums");
  });

  it("replaces an inherited direction and records it through a chained revision", async () => {
    const { root, lyrics, base } = await fixture();
    const first = await reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: 1, expectedBasePayloadHash: base.pack.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "first direction", patch: { direction: "dry clipped drums" } });
    const titleOnly = await reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: first.packVersion, expectedBasePayloadHash: first.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "title only", patch: { title: "Retitled" } });
    expect(titleOnly.effective.direction).toBe("dry clipped drums");
    const replaced = await reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: titleOnly.packVersion, expectedBasePayloadHash: titleOnly.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "replace direction", patch: { direction: "wide bowed bass" } });
    expect(replaced.effective.direction).toBe("wide bowed bass");
    expect(replaced.promptPack.pack.style).toContain("wide bowed bass");
    expect(replaced.promptPack.pack.style).not.toContain("dry clipped drums");
  });

  it("rejects explicit empty exclusions instead of silently inheriting", async () => {
    const { root, lyrics, base } = await fixture();
    await expect(reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: 1, expectedBasePayloadHash: base.pack.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "clear exclusions", patch: { excludeStyles: [] } })).rejects.toThrow("empty exclusions");
  });

  it("fails closed on tampered payloads and direction overflow without changing state", async () => {
    const { root, lyrics, base } = await fixture();
    await writeFile(join(root, "songs/fixture-song/prompts/prompt-pack-v001/suno-payload.json"), "{}\n");
    await expect(reviseSongProduction({ workspaceRoot: root, songId: "fixture-song", basePackVersion: 1, expectedBasePayloadHash: base.pack.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(lyrics) }, producerInstruction: "tampered", patch: { title: "x" } })).rejects.toThrow("payload hash");
    const fresh = await fixture();
    const before = await readSongState(fresh.root, "fixture-song");
    await expect(reviseSongProduction({ workspaceRoot: fresh.root, songId: "fixture-song", basePackVersion: 1, expectedBasePayloadHash: fresh.base.pack.payloadHash, lyric: { kind: "adopted_lyrics", version: 1, hash: hash(fresh.lyrics) }, producerInstruction: "too long", patch: { direction: "x".repeat(1000) } })).rejects.toThrow("style limit");
    expect((await readSongState(fresh.root, "fixture-song")).status).toBe(before.status);
  });
});
