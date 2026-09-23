import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { validateSongbook } from "../src/services/songbookValidator";

describe("songbook validator", () => {
  it("detects missing rows, stale status, and Apple Music candidates", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-songbook-validator-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "where-it-played", "Where It Played");
    await updateSongState(root, "where-it-played", { status: "published" });
    await ensureSongState(root, "song-004", "Lost Room");
    writeFileSync(join(root, "artist", "SONGBOOK.md"), [
      "# SONGBOOK.md",
      "| Song ID | Title | Status | Suno Runs | Selected Take | Public Links |",
      "|---|---|---|---:|---|---|",
      "| where-it-played | Where It Played | scheduled | 0 | | |"
    ].join("\n"));

    const result = await validateSongbook(root, [{ title: "Where It Played", url: "https://music.apple.com/jp/album/where-it-played/1?i=2" }]);

    expect(result.issues.map((issue) => issue.issue).sort()).toEqual(["missing_apple_music", "missing_row", "status_mismatch"].sort());
    expect(result.issues.find((issue) => issue.issue === "missing_apple_music")?.candidateUrl).toContain("music.apple.com");
  });
});
