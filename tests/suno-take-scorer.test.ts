import { describe, expect, it } from "vitest";
import { scoreSunoTakes } from "../src/services/sunoTakeScorer";

describe("suno take scorer", () => {
  it("scores each imported take across lyrics, sonic, and mood axes", () => {
    const scores = scoreSunoTakes({
      urls: ["https://suno.example/good-bass-cold-hook", "https://suno.example/bad-noise"],
      briefText: "Mood: cold\nStyle notes: bass",
      lyricsText: "hook in the chorus"
    });

    expect(scores).toHaveLength(2);
    expect(scores[0].total).toBeGreaterThan(scores[1].total);
    expect(scores[0].reason).toContain("lyrics=");
  });

  it("rejects secret-like scoring input", () => {
    expect(() => scoreSunoTakes({ urls: [`${["TELEGRAM", "BOT", "TOKEN"].join("_")}=12345678`] })).toThrow("suno_take_score_secret_like_input");
  });
});
