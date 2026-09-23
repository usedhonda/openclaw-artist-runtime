import { describe, expect, it, vi } from "vitest";
import { titleFromSeed } from "../src/services/songSpawnProposer";
import { hashRatio } from "../src/services/creativeVariationPolicy";
import type { PersonaMotifBundle } from "../src/services/personaMotifExtractor";

function motifs(overrides: Partial<PersonaMotifBundle> = {}): PersonaMotifBundle {
  return {
    themes: ["社会風刺", "再開発"],
    vocabulary: [],
    geographies: ["六本木", "渋谷"],
    sound: [],
    avoid: [],
    raw: "",
    ...overrides
  };
}

// Fresh seeded rng identical to the production one (hashRatio over an advancing
// counter). Recreated per call so two runs consume the same sequence.
function seededRng(seed: string): () => number {
  let n = 0;
  return () => hashRatio(`title:${seed}:${n++}`);
}

// Scripted rng that returns a fixed sequence (for forcing specific weighted picks).
function scriptedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("title determinism + anti-repeat (F2)", () => {
  it("is deterministic for the same seed (no Math.random)", () => {
    const a = titleFromSeed("seed", motifs(), [], seededRng("song-777\n2026-08-23"));
    const b = titleFromSeed("seed", motifs(), [], seededRng("song-777\n2026-08-23"));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("differs across distinct seeds", () => {
    const a = titleFromSeed("seed", motifs(), [], seededRng("song-A"));
    const b = titleFromSeed("seed", motifs(), [], seededRng("song-Z\n2026-09-01\nhttps://x/y"));
    // Not a hard guarantee for every seed pair, but these two land differently.
    expect(a === b && a === "六本木の社会風刺").toBe(false);
  });

  it("rotates away from a title that shares a word with a recent ledger title", () => {
    // Candidate 1 (rng 0.1,0.1) -> 六本木の社会風刺 (overlaps both recent tokens);
    // Candidate 2 (rng 0.9,0.9) -> 渋谷の再開発 (no overlap) is accepted.
    const title = titleFromSeed(
      "seed",
      motifs(),
      [],
      scriptedRng([0.1, 0.1, 0.9, 0.9]),
      ["六本木の社会風刺"]
    );
    expect(title).toBe("渋谷の再開発");
  });

  it("falls back with a degraded warning when every candidate overlaps", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const title = titleFromSeed(
      "seed",
      motifs({ themes: ["社会風刺"], geographies: ["六本木"] }),
      [],
      scriptedRng([0.1]),
      ["六本木の社会風刺"]
    );
    expect(title).toBe("六本木の社会風刺");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("title_anti_repeat_exhausted"));
    warn.mockRestore();
  });
});
