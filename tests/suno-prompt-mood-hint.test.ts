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
    expect(pack.style).toContain("civic dread pulse");
    expect(pack.style.length).toBeGreaterThanOrEqual(800);
    expect(pack.style.length).toBeLessThanOrEqual(1000);
  });

  it("keeps moodHint while style stays within the dense V5.5 style total", () => {
    const pack = createSunoPromptPack({
      ...base,
      artistReason: "a very long observation reason ".repeat(8),
      moodHint: "civic dread pulse"
    });
    expect(pack.style.length).toBeGreaterThanOrEqual(800);
    expect(pack.style.length).toBeLessThanOrEqual(1000);
    expect(pack.style).toContain("civic dread pulse");
    expect(pack.style).not.toContain("song intent:");
    expect(pack.style).toContain("brushed drums");
  });

  it("keeps dense style bounded when moodHint is oversized", () => {
    const pack = createSunoPromptPack({
      ...base,
      artistReason: "long reason ".repeat(24),
      moodHint: "oversized mood hint ".repeat(12)
    });
    expect(pack.style.length).toBeGreaterThanOrEqual(800);
    expect(pack.style.length).toBeLessThanOrEqual(1000);
    expect(pack.style).not.toContain("song intent:");
    expect(pack.style).toContain("brushed drums");
  });
});
