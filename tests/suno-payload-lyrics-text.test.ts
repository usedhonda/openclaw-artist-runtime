import { describe, expect, it } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";

describe("Suno payload lyrics text split", () => {
  it("stores plain lyricsText separately from YAML lyrics", () => {
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
    expect(pack.payload.lyricsYaml).toContain("title: Plain Signal");
    expect(pack.payload.lyricsYaml).toContain("LYRICS START");
    expect(pack.payload.lyricsYaml).toContain("line one");
    expect(pack.payload.lyrics).toBe(pack.payload.lyricsYaml);
  });
});
