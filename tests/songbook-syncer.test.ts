import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { syncSongbookFromITunes } from "../src/services/songbookSyncer";

function fetchTracks(): typeof fetch {
  return vi.fn(async () => ({
    text: async () => JSON.stringify({
      results: [{ wrapperType: "track", trackName: "Where It Played", trackViewUrl: "https://music.apple.com/jp/song/where-it-played/1" }]
    })
  })) as unknown as typeof fetch;
}

describe("songbook syncer", () => {
  it("backs up and writes Apple Music links through song state sync", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-songbook-syncer-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "where-it-played", "Where It Played");
    await updateSongState(root, "where-it-played", { status: "published" });
    writeFileSync(
      join(root, "artist", "SONGBOOK.md"),
      "| id | title | status | publicLinks |\n| --- | --- | --- | --- |\n| where-it-played | Where It Played | scheduled | - |\n"
    );

    const result = await syncSongbookFromITunes(root, { artistId: "123456789", fetchImpl: fetchTracks() });
    const songbook = readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8");
    const backups = result.backups?.entries ?? [];

    expect(result.updated).toEqual(["where-it-played"]);
    expect((await readSongState(root, "where-it-played")).publicLinks).toContain("https://music.apple.com/jp/song/where-it-played/1");
    expect(songbook).toContain("https://music.apple.com/jp/song/where-it-played/1");
    expect(songbook).toContain("| where-it-played | Where It Played | published |");
    expect(backups.length).toBeGreaterThan(0);
    expect(backups.every((entry) => entry.backupPath && existsSync(entry.backupPath))).toBe(true);
  });
});
