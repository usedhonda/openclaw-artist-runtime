import { describe, expect, it } from "vitest";
import { composeArtistFallback } from "../src/services/artistVoiceComposer";
import type { PersonaMotifBundle } from "../src/services/personaMotifExtractor";

const motifs: PersonaMotifBundle = {
  themes: ["社会風刺", "若者", "権力構造"],
  vocabulary: ["地べた"],
  geographies: ["六本木", "渋谷"],
  sound: ["低いベース"],
  avoid: [],
  raw: "fixture"
};

describe("artist voice fallback rotation", () => {
  it("keeps deterministic override but rotates when selectorSeed changes", () => {
    const base = {
      userMessage: "propose",
      motifs,
      userIntent: "propose" as const
    };

    const first = composeArtistFallback({ ...base, selectorSeed: "run-a" });
    const firstAgain = composeArtistFallback({ ...base, selectorSeed: "run-a" });
    const second = composeArtistFallback({ ...base, selectorSeed: "run-b" });

    expect(first).toBe(firstAgain);
    expect(second).not.toBe(first);
  });
});
