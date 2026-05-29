import { describe, expect, it } from "vitest";
import { selectBestScoredTake } from "../src/services/sunoTakeSelector";
import type { SunoTakeScore } from "../src/services/sunoTakeScorer";

function score(takeId: string, total: number): SunoTakeScore {
  return { takeId, total, url: `https://suno.example/${takeId}`, lyricsScore: total, sonicMatch: total, moodAlignment: total, reason: "test" };
}

describe("suno take selector", () => {
  it("selects the highest scored take with deterministic tie-break", () => {
    expect(selectBestScoredTake([score("b", 0.8), score("a", 0.8)], 0.5)).toMatchObject({
      status: "selected",
      best: { takeId: "a" }
    });
  });

  it("keeps low-score diagnostics available without owning autopilot blocking", () => {
    expect(selectBestScoredTake([score("low", 0.2)], 0.5)).toMatchObject({
      status: "low_score",
      best: { takeId: "low" }
    });
  });
});
