import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAndPersistSunoPromptPack, parseBpmFromBriefTempo } from "../src/services/sunoPromptPackFiles";

describe("Suno V5.5 BPM source of truth", () => {
  it("parses brief tempo values", () => {
    expect(parseBpmFromBriefTempo("142 BPM")).toBe(142);
    expect(parseBpmFromBriefTempo("142")).toBe(142);
    expect(parseBpmFromBriefTempo("artist decides")).toBeUndefined();
  });

  it("plumbs brief tempo into style, YAML, and payload without falling back to 124", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-v55-bpm-"));
    await mkdir(join(root, "songs", "song-bpm"), { recursive: true });
    await writeFile(join(root, "songs", "song-bpm", "brief.md"), ["# Brief", "", "- Tempo: 142 BPM"].join("\n"), "utf8");

    const result = await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-bpm",
      songTitle: "BPM Civic Gate",
      artistReason: "brief tempo should drive every Suno field",
      lyricsText: "[Verse 1]\nまちのあかりがおくれてもどる",
      moodHint: "dry civic pulse"
    });

    const style = readFileSync(result.artifactPaths.styleLatest, "utf8");
    const yaml = readFileSync(result.artifactPaths.yamlLatest, "utf8");
    const payload = readFileSync(result.artifactPaths.payloadLatest, "utf8");
    expect(style).toContain("BPM 142");
    expect(yaml).toContain("tempo: 142");
    expect(payload).toContain("BPM 142");
    expect(payload).not.toContain("tempo: 124");
  });
});
