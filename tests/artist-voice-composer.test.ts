import { describe, expect, it } from "vitest";
import { composeArtistFallback } from "../src/services/artistVoiceComposer";
import type { PersonaMotifBundle } from "../src/services/personaMotifExtractor";

const emptyMotifs: PersonaMotifBundle = {
  themes: [],
  vocabulary: [],
  geographies: [],
  sound: [],
  avoid: [],
  raw: ""
};

const motifs: PersonaMotifBundle = {
  themes: ["社会風刺"],
  vocabulary: ["皮肉"],
  geographies: ["渋谷"],
  sound: ["nu-jazz rap"],
  avoid: ["説明口調"],
  raw: "artist motifs"
};

describe("artist voice fallback composer", () => {
  it("uses a minimal fallback when motifs are empty without repeating the user message", () => {
    const text = composeArtistFallback({
      userMessage: "この話どう思う?",
      motifs: emptyMotifs,
      userIntent: "discuss"
    });

    expect(text).toMatch(/うん|聞いてる|引っかかる/);
    expect(text).not.toContain("I heard this:");
    expect(text).not.toContain("この話どう思う");
  });

  it("anchors proposal replies to geography and theme motifs", () => {
    const text = composeArtistFallback({
      userMessage: "次の案ある?",
      motifs,
      tone: "短く、刺す",
      currentMood: "低い熱",
      userIntent: "propose"
    });

    expect(text).toContain("渋谷");
    expect(text).toContain("社会風刺");
  });

  it("keeps ack replies short", () => {
    const text = composeArtistFallback({
      userMessage: "了解して",
      motifs,
      userIntent: "ack"
    });

    expect(text.length).toBeLessThanOrEqual(10);
  });

  it("is deterministic for identical input", () => {
    const input = {
      userMessage: "この方向で進めて",
      motifs,
      tone: "短く、刺す",
      currentMood: "低い熱",
      userIntent: "discuss" as const
    };

    expect(composeArtistFallback(input)).toBe(composeArtistFallback(input));
  });
});
