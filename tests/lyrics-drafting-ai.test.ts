import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { draftLyrics } from "../src/services/lyricsDrafting";
import { readSongState } from "../src/services/artistState";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-lyrics-ai-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "songs", "song-001", "lyrics"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "used::honda watches civic noise and soft decay.\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "## Current Obsessions\n- group chats replacing civic rooms\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short and unsentimental\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "song.md"), "# Dead Neon Clock\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "brief.md"), [
    "# Brief",
    "## Observation source",
    "- Path: observations/2026-04-30.md",
    "- Extract:",
    "government WhatsApp groups make responsibility leave the room"
  ].join("\n"), "utf8");
  return root;
}

describe("AI lyrics drafting", () => {
  it("drafts lyrics, short title, and mood hint from the observation-bearing brief", async () => {
    const root = await workspace();
    const result = await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "mock" });
    const state = await readSongState(root, "song-001");

    expect(result.lyricsText).toContain("government WhatsApp groups");
    expect(state.title.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(state.degradedLyrics).toBe(false);
    expect(readFileSync(join(root, "songs", "song-001", "mood-hint.txt"), "utf8")).toContain("observed urban unease");
  });

  it("marks degraded lyrics and stops when the provider only returns fallback text", async () => {
    const root = await workspace();

    await expect(draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openclaw" })).rejects.toThrow("lyrics_generation_degraded");
    const state = await readSongState(root, "song-001");
    expect(state.degradedLyrics).toBe(true);
    expect(state.status).toBe("brief");
  });
});
