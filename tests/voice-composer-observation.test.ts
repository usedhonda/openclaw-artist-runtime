import { describe, expect, it } from "vitest";
import { composeArtistFallback } from "../src/services/artistVoiceComposer";
import type { PersonaMotifBundle } from "../src/services/personaMotifExtractor";

const motifs: PersonaMotifBundle = {
  themes: ["社会風刺", "若者"],
  vocabulary: ["再開発"],
  geographies: ["六本木", "渋谷"],
  sound: ["nu-jazz"],
  avoid: ["説明口調"],
  raw: "fixture"
};

describe("artist voice composer observation cascade", () => {
  it("uses observation material in propose voice instead of the fixed first motif line", () => {
    const text = composeArtistFallback({
      userMessage: "propose",
      motifs,
      userIntent: "propose",
      selectorSeed: "obs-a",
      observationContext: {
        trigger: {
          kind: "x",
          quote: "再開発の街で若者の声だけが置き去りになっていた",
          author: "street",
          topic: "再開発の街",
          motifMatch: "若者/再開発"
        },
        observationTopTags: ["若者", "再開発"]
      }
    });

    expect(text).toMatch(/再開発|若者|置き去り/);
    expect(text).not.toBe("ゆずるさん、六本木の社会風刺を切るやつ、どう?");
  });
});
