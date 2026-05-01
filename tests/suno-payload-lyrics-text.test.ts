import { describe, expect, it } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";

describe("Suno payload lyrics text split", () => {
  it("stores UI lyrics body separately from full YAML and fallback lyricsText", () => {
    const pack = createSunoPromptPack({
      songId: "song-plain",
      songTitle: "Plain Signal",
      artistReason: "test",
      lyricsText: "line one\nline two",
      artistSnapshot: "# ARTIST\n",
      currentStateSnapshot: "# CURRENT\n",
      knowledgePackVersion: "test"
    });

    expect(pack.payload.lyricsText).toBe("line one\nline two");
    expect(pack.payload.lyrics).toBe("line one\nline two");
    expect(pack.payload.payloadYaml).toBe(pack.yamlLyrics);
    expect(pack.payload.payloadYaml).toContain("title: Plain Signal");
    expect(pack.payload.payloadYaml).toContain("LYRICS START");
    expect(pack.payload.payloadYaml).toContain("line one");
    expect(pack.payload.lyricsYaml).toContain("title: Plain Signal");
    expect(pack.payload.lyricsYaml).toContain("LYRICS START");
    expect(pack.payload.lyricsYaml).toContain("line one");
    expect(pack.payload.lyrics).not.toContain("title: Plain Signal");
    expect(pack.payload.lyrics).not.toContain("LYRICS START");
  });
});
