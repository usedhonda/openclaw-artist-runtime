import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readSongState } from "../src/services/artistState";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
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
    expect(metadata.charCounts.lyrics).toBeLessThan(1500);
    expect(metadata.charCounts.lyrics).toBeLessThanOrEqual(3000);
    expect(metadata.charCounts.title).toBe("Character Gate".length);
    expect(metadata.charCounts.styleZone).toBe("sweet");
    expect(metadata.charCounts.lyricsZone).toBe("short");
  });

  it("warns validation when lyrics fall below the preferred floor", () => {
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
    expect(validation.errors.join("\n")).not.toContain("lyrics length out of range");
    expect(validation.warnings.join("\n")).toContain("lyrics length below preferred floor");
  });

  it("stops the prompt-pack pipeline when YAML would exceed the effective Suno box", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-v55-box-"));
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    vi.stubEnv("OPENCLAW_SUNO_LYRICS_LIMIT", "900");

    try {
      await expect(createAndPersistSunoPromptPack({
        workspaceRoot: root,
        songId: "song-overflow",
        songTitle: "Overflow Gate",
        artistReason: "lyrics must not be sliced",
        lyricsText: `[Verse 1]\n${"あ".repeat(820)}`,
        moodHint: "dry civic pulse",
        bpm: 142
      })).rejects.toThrow("lyrics_too_long_for_suno_box");

      const state = await readSongState(root, "song-overflow");
      const degraded = events.find((event) => event.type === "lyrics_generation_degraded");
      expect(state.status).toBe("brief");
      expect(state.degradedLyrics).toBe(true);
      expect(state.lastReason).toContain("lyrics_too_long_for_suno_box");
      expect(degraded).toMatchObject({
        type: "lyrics_generation_degraded",
        songId: "song-overflow",
        reason: expect.stringContaining("lyrics_too_long_for_suno_box")
      });
    } finally {
      vi.unstubAllEnvs();
      unsubscribe();
    }
  });
});
