import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSongEventsResponse } from "../src/routes";
import { appendRuntimeEvent, readSongEventsAsc } from "../src/services/runtimeEventsLedger";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-song-events-"));
}

describe("song runtime events ledger", () => {
  it("returns song events in chronological order and ignores missing ledgers", async () => {
    const root = makeRoot();

    await expect(readSongEventsAsc(root, "song-001")).resolves.toEqual([]);

    await appendRuntimeEvent(root, { type: "prompt_pack_ready", songId: "song-001", title: "Ash", lyricsExcerpt: "a", mood: "cold", tempo: "90 BPM", styleNotes: "sparse", timestamp: 200 });
    await appendRuntimeEvent(root, { type: "song_spawn_proposed", candidateSongId: "spawn_1", brief: { songId: "spawn_1", title: "Other", brief: "b", lyricsTheme: "l", mood: "m", tempo: "t", duration: "d", styleNotes: "s", sourceText: "x", createdAt: "2026-05-12T00:00:00.000Z" }, reason: "r", timestamp: 150 });
    await appendRuntimeEvent(root, { type: "suno_generate_retry", songId: "song-001", reason: "retry", retryCount: 1, timestamp: 250 });

    const events = await readSongEventsAsc(root, "song-001");
    expect(events.map((event) => event.type)).toEqual(["prompt_pack_ready", "suno_generate_retry"]);
  });

  it("builds the route response with serialized song events", async () => {
    const root = makeRoot();
    await appendRuntimeEvent(root, { type: "take_select_pending", songId: "song-002", reason: "wait", timestamp: 300 });

    const response = await buildSongEventsResponse("song-002", { artist: { workspaceRoot: root } }, 10);

    expect(response.events).toHaveLength(1);
    expect(response.events[0]).toMatchObject({ type: "take_select_pending", songId: "song-002" });
  });
});
