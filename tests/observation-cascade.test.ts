import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSongIdea } from "../src/services/songIdeation";
import { draftLyrics } from "../src/services/lyricsDrafting";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { readSongState } from "../src/services/artistState";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-observation-cascade-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "observations"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "used::honda turns civic systems into songs.\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "## Current Obsessions\n- disappearing civic rooms\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short\n", "utf8");
  return root;
}

describe("observation cascade", () => {
  it("threads observations through brief, lyrics, ledger refs, and Suno style", async () => {
    const root = await workspace();
    const observationPath = join(root, "observations", "2026-04-30.md");
    const observationText = "- text: \"old live houses disappear under identical signs\"\n  author: \"citywatch\"\n  url: \"https://x.com/citywatch/status/1\"";
    await writeFile(observationPath, observationText, "utf8");

    const idea = await createSongIdea({
      workspaceRoot: root,
      theme: "civic rooms erased",
      artistReason: "observation pressure",
      observationText,
      observationPath
    });
    expect(readFileSync(idea.briefPath, "utf8")).toContain("old live houses disappear");

    const lyrics = await draftLyrics({ workspaceRoot: root, songId: idea.songId, aiReviewProvider: "mock" });
    expect(lyrics.lyricsText).toContain("old live houses");
    const state = await readSongState(root, idea.songId);

    const pack = await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: idea.songId,
      songTitle: state.title,
      artistReason: "cascade",
      lyricsText: lyrics.lyricsText,
      knowledgePackVersion: "test",
      moodHint: readFileSync(join(root, "songs", idea.songId, "mood-hint.txt"), "utf8").trim(),
      observationPath
    });

    expect(pack.pack.style).toContain("observed urban unease");
    expect(readFileSync(pack.artifactPaths.promptLedger, "utf8")).toContain("observations/2026-04-30.md");
  });
});
