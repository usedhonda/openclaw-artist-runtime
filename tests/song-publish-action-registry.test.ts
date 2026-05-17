import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState, updateSongState } from "../src/services/artistState";
import { listSongPublishActions, runSongPublishAction } from "../src/services/songPublishActionRegistry";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-song-publish-action-"));
}

async function prepareWorkspace(): Promise<string> {
  const root = workspace();
  await ensureArtistWorkspace(root);
  await updateSongState(root, "where-it-played", {
    title: "Where It Played",
    status: "take_selected",
    selectedTakeId: "take-1"
  });
  return root;
}

describe("song publish action registry", () => {
  it("writes SONGBOOK state only for the song_songbook_write action", async () => {
    const root = await prepareWorkspace();

    const result = await runSongPublishAction("song_songbook_write", {
      root,
      songId: "where-it-played",
      now: 1000
    });

    expect(result.status).toBe("applied");
    expect(result.song?.status).toBe("published");
    expect(result.safety).toEqual({ autopilotDryRun: true, liveGoArmed: false });
    expect(result.backups?.entries.map((entry) => entry.sourcePath).sort()).toEqual([
      join(root, "artist", "SONGBOOK.md"),
      join(root, "songs", "where-it-played", "song.md")
    ].sort());
    for (const entry of result.backups?.entries ?? []) {
      expect(entry.backupPath ? existsSync(entry.backupPath) : false).toBe(true);
    }
    expect((await readSongState(root, "where-it-played")).status).toBe("published");
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toContain("| where-it-played | Where It Played | published |");
  });

  it("keeps song files unchanged for skip and does not register real publish actions", async () => {
    const root = await prepareWorkspace();
    const beforeSong = readFileSync(join(root, "songs", "where-it-played", "song.md"), "utf8");
    const beforeSongbook = readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8");

    const result = await runSongPublishAction("song_skip", {
      root,
      songId: "where-it-played",
      now: 1000
    });

    expect(result.status).toBe("discarded");
    expect(readFileSync(join(root, "songs", "where-it-played", "song.md"), "utf8")).toBe(beforeSong);
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toBe(beforeSongbook);
    expect(listSongPublishActions().map((definition) => definition.action)).toEqual([
      "song_songbook_write",
      "song_skip",
      "song_archive",
      "song_discard"
    ]);
    expect(listSongPublishActions().map((definition) => definition.action).join(" ")).not.toMatch(/x|instagram|tiktok|publish/i);
  });
});
