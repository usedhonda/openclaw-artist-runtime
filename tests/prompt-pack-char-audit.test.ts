import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { validateSunoPromptPack } from "../src/validators/promptPackValidator";

describe("prompt pack character audit", () => {
  it("stores style, lyrics, and title character counts in metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-v55-char-"));
    const result = await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-char",
      songTitle: "Character Gate",
      artistReason: "character counts must be visible",
      lyricsText: "[Verse 1]\n街の灯りが遅れる",
      moodHint: "dry civic pulse",
      bpm: 142
    });

    const metadata = JSON.parse(readFileSync(join(result.artifactPaths.snapshotDir, "metadata.json"), "utf8")) as {
      charCounts: { style: number; lyrics: number; title: number; styleZone: string; lyricsZone: string; titleZone: string };
    };
    expect(metadata.charCounts.style).toBeGreaterThanOrEqual(800);
    expect(metadata.charCounts.style).toBeLessThanOrEqual(1000);
    expect(metadata.charCounts.lyrics).toBeGreaterThanOrEqual(1500);
    expect(metadata.charCounts.lyrics).toBeLessThanOrEqual(3000);
    expect(metadata.charCounts.title).toBe("Character Gate".length);
    expect(metadata.charCounts.styleZone).toBe("sweet");
  });

  it("fails validation when style or lyrics fall below the enforced floor", () => {
    const validation = validateSunoPromptPack({
      songId: "song-short",
      songTitle: "Short Gate",
      style: "too short",
      exclude: "generic reverb",
      yamlLyrics: "gender: male",
      payload: { lyrics: "短い" },
      artistSnapshotHash: "a",
      currentStateHash: "b",
      payloadHash: "c",
      knowledgePackHash: "d"
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join("\n")).toContain("styleAndFeel length out of range");
    expect(validation.errors.join("\n")).toContain("lyrics length out of range");
  });
});
