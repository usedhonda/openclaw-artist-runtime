import { describe, expect, it } from "vitest";
import { buildStyle } from "../src/suno-production/buildStyle";

describe("style boundary trim", () => {
  it("trims over-limit style text at a phrase boundary instead of cutting words", () => {
    const result = buildStyle({
      genre: "nu-jazz rap",
      bpm: 142,
      key: "C minor",
      vibe: "civic pressure behind glass",
      moodHint: "civic pressure behind glass",
      instruments: [
        "light saturation organ pads",
        "talk-sung bass clarinet texture",
        "municipal Rhodes clusters",
        "wide glass synth phrases",
        "tight brushed drums",
        "low sax shadows",
        "dry finger bass"
      ],
      performanceDirection:
        "Keep the vocal close, male, dry, and managerially restrained while each section changes texture without a pop lift."
    });

    expect(result.total.length).toBeLessThanOrEqual(1000);
    expect(result.total).not.toContain("managerially restrained while\ncivic pressure behind glass");
    expect(result.total).toMatch(/\n-\s[A-Za-z][^\n]+\ncivic pressure behind glass$/);
  });
});
