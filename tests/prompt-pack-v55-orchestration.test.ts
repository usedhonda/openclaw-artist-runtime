import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { validateNoCommandLeak } from "../src/services/lyricsValidator";

const lyrics = [
  "[Intro - muted street image]",
  "駅前の時計だけが少し遅れる",
  "",
  "[Verse 1 - tight civic flow]",
  "誰も見ない窓にだけ信号が残る",
  "既読の街で責任だけが遅れる",
  "低いベースが名前を削っていく",
  "朝の手前でまだ息を数える"
].join("\n");

describe("Suno V5.5 prompt pack orchestration", () => {
  it("orchestrates lyrics through style, exclude, YAML, sliders, and payload contract", () => {
    const pack = createSunoPromptPack({
      songId: "song-010",
      songTitle: "Civic Echo",
      artistReason: "observation from city redevelopment",
      lyricsText: lyrics,
      moodHint: "civic dread pulse",
      artistSnapshot: "# ARTIST\nused::honda watches civic noise",
      currentStateSnapshot: "# CURRENT\nobservational"
    });

    expect(pack.lyricsBundle?.lyricsText).toBe(lyrics);
    expect(pack.style.length).toBeGreaterThanOrEqual(800);
    expect(pack.style.length).toBeLessThanOrEqual(1000);
    expect(pack.style).toContain("Knowledge Vocabulary");
    expect(pack.exclude.length).toBeLessThanOrEqual(200);
    expect(pack.yamlLyrics.length).toBeLessThanOrEqual(4000);
    expect(pack.yamlLyrics).toContain("LYRICS START");
    expect(String(pack.payload.lyrics)).toContain(lyrics);
    expect(String(pack.payload.lyricsText)).toContain(lyrics);
    expect(String(pack.payload.lyrics).length).toBeLessThan(1500);
    expect(pack.payload.payloadYaml).toBe(pack.yamlLyrics);
    expect(pack.sliders.weirdness).toBeGreaterThanOrEqual(15);
    expect(pack.sliders.weirdness).toBeLessThanOrEqual(85);
    expect(pack.validation.valid).toBe(true);
  });

  it("drops songwriting meta before writing Suno UI lyrics", () => {
    const leakedLyrics = [
      "[Verse 1 - tight civic flow, note: AABB and internal rhyme]",
      "誰も見ない窓にだけ信号が残る",
      "flow = リズム + phrasing + accent + rhyme",
      "低いベースが名前を削っていく",
      "AABBで韻を踏む",
      "朝の手前でまだ息を数える",
      "",
      "[Hook - final anchor]",
      "街が薄くなる",
      "拍手だけ残る"
    ].join("\n");

    const pack = createSunoPromptPack({
      songId: "song-leak",
      songTitle: "Leak Guard",
      artistReason: "observation from city redevelopment",
      lyricsText: leakedLyrics,
      moodHint: "civic dread pulse",
      artistSnapshot: "# ARTIST\nused::honda watches civic noise",
      currentStateSnapshot: "# CURRENT\nobservational"
    });

    expect(String(pack.payload.lyrics)).not.toContain("flow =");
    expect(String(pack.payload.lyrics)).not.toContain("AABB");
    expect(String(pack.payload.lyrics)).not.toContain("internal rhyme");
    expect(String(pack.payload.lyricsText)).not.toContain("flow =");
    expect(String(pack.payload.lyricsText)).not.toContain("AABB");
    expect(String(pack.yamlLyrics)).not.toContain("flow =");
    expect(validateNoCommandLeak(String(pack.payload.lyrics))).toEqual([]);
  });

  it("persists style, exclude, yaml-suno, and lyrics-suno under the song Suno directory", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-v55-pack-"));
    await mkdir(join(workspaceRoot, "observations"), { recursive: true });
    const observationPath = join(workspaceRoot, "observations", "2026-05-01.md");
    await writeFile(observationPath, "- text: civic rooms moved into group chats\n", "utf8");

    const result = await createAndPersistSunoPromptPack({
      workspaceRoot,
      songId: "song-010",
      songTitle: "Civic Echo",
      artistReason: "observation from city redevelopment",
      lyricsText: lyrics,
      moodHint: "civic dread pulse",
      observationPath
    });

    const style = readFileSync(result.artifactPaths.styleLatest, "utf8");
    const exclude = readFileSync(result.artifactPaths.excludeLatest, "utf8");
    const yaml = readFileSync(result.artifactPaths.yamlLatest, "utf8");
    const lyricsSuno = readFileSync(result.artifactPaths.lyricsSunoLatest, "utf8");
    const payload = JSON.parse(readFileSync(result.artifactPaths.payloadLatest, "utf8")) as Record<string, unknown>;
    const ledger = readFileSync(result.artifactPaths.promptLedger, "utf8");

    expect(result.artifactPaths.styleLatest.endsWith("songs/song-010/suno/style.md")).toBe(true);
    expect(result.artifactPaths.excludeLatest.endsWith("songs/song-010/suno/exclude.md")).toBe(true);
    expect(result.artifactPaths.yamlLatest.endsWith("songs/song-010/suno/yaml-suno.md")).toBe(true);
    expect(result.artifactPaths.lyricsSunoLatest.endsWith("songs/song-010/suno/lyrics-suno.md")).toBe(true);
    expect(style.length).toBeGreaterThanOrEqual(801);
    expect(style.length).toBeLessThanOrEqual(1001);
    expect(style).toContain("Knowledge Vocabulary");
    expect(exclude.length).toBeLessThanOrEqual(201);
    expect(yaml).toContain("LYRICS START");
    expect(lyricsSuno).toContain("[Verse 1 - tight civic flow]");
    expect(String(payload.lyrics)).toContain(lyrics);
    expect(String(payload.lyricsText)).toContain(lyrics);
    expect(String(payload.lyrics).length).toBeLessThan(1500);
    expect(payload.payloadYaml).toBe(result.pack.yamlLyrics);
    expect(String(payload.lyrics)).not.toContain("LYRICS START");
    expect(String(payload.lyrics)).not.toContain("# META");
    expect(ledger).toContain("style.md");
    expect(ledger).toContain("exclude.md");
    expect(ledger).toContain("yaml-suno.md");
    expect(ledger).toContain("lyrics-suno.md");
    expect(ledger).toContain("observations/2026-05-01.md");
  });
});
