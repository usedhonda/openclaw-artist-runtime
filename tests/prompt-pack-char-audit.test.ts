import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readSongState } from "../src/services/artistState";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { classifyLyricsZoneForPromptCounts } from "../src/suno-production/generatePromptPack";
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

  it("classifies near/under lyric zones from bare lyrics after marker budget", () => {
    expect(classifyLyricsZoneForPromptCounts(1200, 3200, 4400, 4800)).toBe("underused");
    expect(classifyLyricsZoneForPromptCounts(1500, 3200, 4700, 4800)).toBe("near_max");
    expect(classifyLyricsZoneForPromptCounts(1500, 3301, 4801, 4800)).toBe("overflow");
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

  it("self-repairs known residual kanji in Suno registration lyrics without changing source lyrics", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-v55-kanji-"));
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    try {
      const result = await createAndPersistSunoPromptPack({
        workspaceRoot: root,
        songId: "song-kanji-repair",
        songTitle: "Kanji Repair",
        artistReason: "Suno registration lyrics must be hiragana",
        lyricsText: "[Verse 1]\n街の灯りが遅れる",
        moodHint: "dry civic pulse",
        bpm: 142
      });

      const state = await readSongState(root, "song-kanji-repair");
      const sourceLyrics = readFileSync(join(root, "songs", "song-kanji-repair", "lyrics", "lyrics.v1.md"), "utf8");
      const sunoLyrics = readFileSync(result.artifactPaths.lyricsSunoLatest, "utf8");
      const degraded = events.find((event) => event.type === "lyrics_generation_degraded" && event.songId === "song-kanji-repair");
      expect(state.status).toBe("suno_prompt_pack");
      expect(state.degradedLyrics).not.toBe(true);
      expect(sourceLyrics).toContain("街の灯りが遅れる");
      expect(sunoLyrics).toContain("まちのあかりがおくれる");
      expect(degraded).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });
});
