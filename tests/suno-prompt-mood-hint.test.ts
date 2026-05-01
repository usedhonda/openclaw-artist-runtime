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
    expect(pack.style.length).toBeLessThanOrEqual(400);
  });

  it("keeps moodHint while style stays within the V5.5 400 char total", () => {
    const pack = createSunoPromptPack({
      ...base,
      artistReason: "a very long observation reason ".repeat(8),
      moodHint: "civic dread pulse"
    });
    expect(pack.style.length).toBeLessThanOrEqual(400);
    expect(pack.style).toContain("civic dread pulse");
    expect(pack.style).not.toContain("song intent:");
    expect(pack.style).toContain("brushed drums");
  });

  it("drops oversized moodHint when core tags exceed 120 chars", () => {
    const pack = createSunoPromptPack({
      ...base,
      artistReason: "long reason ".repeat(24),
      moodHint: "oversized mood hint ".repeat(12)
    });
    expect(pack.style.length).toBeLessThanOrEqual(400);
    expect(pack.style).not.toContain("song intent:");
    expect(pack.style).not.toContain("oversized mood hint");
    expect(pack.style).toContain("brushed drums");
  });
});
