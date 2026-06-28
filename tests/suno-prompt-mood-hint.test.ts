import { describe, expect, it } from "vitest";
import { createSunoPromptPack } from "../src/suno-production/generatePromptPack";
import { CANONICAL_STYLE_TARGET_MAX_CHARS } from "../src/suno-production/buildStyle";

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
    expect(pack.style.length).toBeLessThanOrEqual(CANONICAL_STYLE_TARGET_MAX_CHARS);
  });

  it("keeps moodHint while style stays within the canonical V5.5 style total", () => {
    const pack = createSunoPromptPack({
      ...base,
      artistReason: "a very long observation reason ".repeat(8),
      moodHint: "civic dread pulse"
    });
    expect(pack.style.length).toBeLessThanOrEqual(CANONICAL_STYLE_TARGET_MAX_CHARS);
    expect(pack.style).toContain("civic dread pulse");
    expect(pack.style).not.toContain("song intent:");
    expect(pack.style).toContain("brushed drums");
  });

  it("keeps canonical style bounded when moodHint is oversized", () => {
    const pack = createSunoPromptPack({
      ...base,
      artistReason: "long reason ".repeat(24),
      moodHint: "oversized mood hint ".repeat(12)
    });
    expect(pack.style.length).toBeLessThanOrEqual(CANONICAL_STYLE_TARGET_MAX_CHARS);
    expect(pack.style).not.toContain("song intent:");
    expect(pack.style).toContain("brushed drums");
  });

  it("honors dopagaki variation from the artist snapshot without per-song prompt text", () => {
    const pack = createSunoPromptPack({
      ...base,
      artistReason: "city observation without explicit style request",
      moodHint: "late-night urban pressure",
      artistSnapshot: [
        "# ARTIST.md",
        "## Sound",
        "- Genre DNA: hip-hop",
        "- nu-jazz rap",
        "- Variation accents: ドパガキ強め / low-slung jazz grit / dry Brooklyn pocket.",
        "- Dopagaki pressure: explicit high-stimulus accent inside the current style.",
        "## Lyrics",
        "- Language policy: Japanese 60% / English 40%; chorus may use English up to 40%."
      ].join("\n")
    });

    expect(pack.style).toContain("overt dopamine-pop pressure");
    expect(pack.style).toContain("instant bilingual chant hook");
    expect(pack.style).toContain("glitch-vocal");
    expect(String(pack.payload.styleAndFeel)).toContain("overt dopamine-pop pressure");
    expect(pack.yamlLyrics).toContain("language: Japanese 60% / English 40%");
  });
});
