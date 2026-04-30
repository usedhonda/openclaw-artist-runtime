import { describe, expect, it } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";

const base = {
  songId: "song-001",
  songTitle: "Civic Echo",
  artistReason: "motif",
  lyricsText: "line one\nline two",
  artistSnapshot: "# ARTIST\n",
  currentStateSnapshot: "# CURRENT\n",
  knowledgePackVersion: "test"
};

describe("Suno prompt mood hint", () => {
  it("injects moodHint as one style token", () => {
    const pack = createSunoPromptPack({ ...base, moodHint: "civic dread pulse" });
    expect(pack.style).toContain("cold synth texture, civic dread pulse, restrained drums");
  });

  it("keeps style under 120 chars and drops moodHint before cutting fixed tokens", () => {
    const pack = createSunoPromptPack({
      ...base,
      artistReason: "a very long observation reason that would push the style over the strict character limit",
      moodHint: "this entire mood hint should disappear first"
    });
    expect(pack.style.length).toBeLessThanOrEqual(120);
    expect(pack.style).not.toContain("this entire mood hint");
    expect(pack.style).toContain("restrained drums");
  });
});
