import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { updateSongState } from "../src/services/artistState";
import { writeAutopilotRunState } from "../src/services/autopilotService";
import { resurfaceDegradedLyrics } from "../src/services/degradedLyricsResurfaceService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-degraded-resurface-"));
}

describe("degraded lyrics resurface", () => {
  it("re-emits lyrics_generation_degraded with restored reason and repair notes", async () => {
    const workspace = root();
    await ensureArtistWorkspace(workspace);
    await updateSongState(workspace, "song-lyrics", {
      title: "Lyrics Stuck",
      status: "brief",
      degradedLyrics: true,
      reason: "lyrics_generation_degraded: provider fallback response | missing hook"
    });
    await writeAutopilotRunState(workspace, {
      runId: "degraded",
      currentSongId: "song-lyrics",
      stage: "paused",
      paused: true,
      blockedReason: "lyrics_generation_degraded: provider fallback response",
      retryCount: 1,
      cycleCount: 1,
      updatedAt: new Date(1000).toISOString(),
      lastRunAt: new Date(1000).toISOString()
    });
    const events: RuntimeEvent[] = [];
    const bus = getRuntimeEventBus();
    bus.clearForTest();
    const unsubscribe = bus.subscribe((event) => events.push(event));

    const result = await resurfaceDegradedLyrics(workspace, { now: 2000 });
    unsubscribe();

    expect(result).toMatchObject({ resurfaced: true, reason: "lyrics_generation_degraded_resurfaced", songId: "song-lyrics" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "lyrics_generation_degraded",
      songId: "song-lyrics",
      reason: "lyrics_generation_degraded: provider fallback response | missing hook",
      detail: "provider fallback response | missing hook",
      repairNotes: ["provider fallback response", "missing hook"],
      timestamp: 2000
    });
  });

  it("does not emit for terminal or non-degraded songs", async () => {
    const workspace = root();
    await ensureArtistWorkspace(workspace);
    await updateSongState(workspace, "song-archived", {
      title: "Done",
      status: "archived",
      degradedLyrics: true,
      reason: "lyrics_generation_degraded: old"
    });
    await updateSongState(workspace, "song-clean", {
      title: "Clean",
      status: "brief",
      degradedLyrics: false,
      reason: "brief updated"
    });
    const events: RuntimeEvent[] = [];
    const bus = getRuntimeEventBus();
    bus.clearForTest();
    const unsubscribe = bus.subscribe((event) => events.push(event));

    await expect(resurfaceDegradedLyrics(workspace, { songId: "song-archived" })).resolves.toMatchObject({ resurfaced: false, reason: "song_not_found" });
    await expect(resurfaceDegradedLyrics(workspace, { songId: "song-clean" })).resolves.toMatchObject({ resurfaced: false, reason: "not_degraded_lyrics" });
    unsubscribe();

    expect(events).toHaveLength(0);
  });
});
