import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readSongState } from "../src/services/artistState";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { CANONICAL_STYLE_TARGET_MAX_CHARS } from "../src/suno-production/buildStyle";
import { validateSunoPromptPack } from "../src/validators/promptPackValidator";

describe("prompt pack character audit", () => {
  it("stores style, lyrics, and title character counts in metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-v55-char-"));
    const result = await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-char",
      songTitle: "Character Gate",
      artistReason: "character counts must be visible",
      lyricsText: "[Verse 1]\nまちのあかりがおくれる",
      moodHint: "dry civic pulse",
      bpm: 142
    });

    const metadata = JSON.parse(readFileSync(join(result.artifactPaths.snapshotDir, "metadata.json"), "utf8")) as {
      charCounts: { style: number; lyrics: number; title: number; styleZone: string; lyricsZone: string; titleZone: string; submittedPayloadChars: number; effectiveLyricsBoxLimit: number; plannedBars: number };
    };
    expect(metadata.charCounts.style).toBeGreaterThan(80);
    expect(metadata.charCounts.style).toBeLessThanOrEqual(CANONICAL_STYLE_TARGET_MAX_CHARS);
    expect(metadata.charCounts.lyrics).toBeLessThan(metadata.charCounts.submittedPayloadChars);
    expect(metadata.charCounts.submittedPayloadChars).toBeLessThanOrEqual(metadata.charCounts.effectiveLyricsBoxLimit);
    expect(metadata.charCounts.title).toBe("Character Gate".length);
    expect(metadata.charCounts.styleZone).toBe("sweet");
    expect(metadata.charCounts.lyricsZone).toMatch(/underused|near_max/);
    expect(metadata.charCounts.plannedBars).toBe(80);
  });

  it("warns validation when submitted payload leaves box budget underused", () => {
    const validation = validateSunoPromptPack({
      songId: "song-short",
      songTitle: "Short Gate",
      style: "nu-jazz rap, dry civic pulse, BPM 142, mid-range male rap vocal",
      exclude: "generic reverb",
      yamlLyrics: "gender: male",
      payload: { lyrics: "みじかい", payloadYaml: "# META (hints; do not sing)\n=== LYRICS START (do not sing tags) ===\nみじかい\n=== LYRICS END ===" },
      artistSnapshotHash: "a",
      currentStateHash: "b",
      payloadHash: "c",
      knowledgePackHash: "d"
    });

    expect(validation.valid).toBe(true);
    expect(validation.errors.join("\n")).not.toContain("lyrics length out of range");
    expect(validation.warnings.join("\n")).toContain("payloadYaml leaves Suno lyrics box budget underused");
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

  it("stops the prompt-pack pipeline when Suno registration lyrics still contain kanji", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-v55-kanji-"));
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    try {
      await expect(createAndPersistSunoPromptPack({
        workspaceRoot: root,
        songId: "song-kanji-stop",
        songTitle: "Kanji Stop",
        artistReason: "Suno registration lyrics must be hiragana",
        lyricsText: "[Verse 1]\n街の灯りが遅れる",
        moodHint: "dry civic pulse",
        bpm: 142
      })).rejects.toThrow("suno_prompt_pack_invalid");

      const state = await readSongState(root, "song-kanji-stop");
      const degraded = events.find((event) => event.type === "lyrics_generation_degraded" && event.songId === "song-kanji-stop");
      expect(state.status).toBe("brief");
      expect(state.degradedLyrics).toBe(true);
      expect(state.lastReason).toContain("suno_prompt_pack_invalid");
      expect(degraded).toMatchObject({
        type: "lyrics_generation_degraded",
        songId: "song-kanji-stop",
        reason: expect.stringContaining("suno_prompt_pack_invalid")
      });
    } finally {
      unsubscribe();
    }
  });
});
