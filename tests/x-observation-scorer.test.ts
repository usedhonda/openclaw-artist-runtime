import { describe, expect, it } from "vitest";
import { rankObservations, scoreObservation, summarizeMatches } from "../src/services/xObservationScorer";
import type { PersonaMotifBundle } from "../src/services/personaMotifExtractor";

const motifs: PersonaMotifBundle = {
  themes: ["社会風刺", "再開発", "権力構造"],
  vocabulary: ["経営者", "地べた"],
  geographies: ["六本木", "渋谷", "ブルックリン"],
  sound: ["Rhodes", "ホーン"],
  avoid: ["副業", "稼げる"],
  raw: ""
};

describe("x observation scorer", () => {
  it("scores entries higher when geographies hit", () => {
    const lyric = scoreObservation({ text: "渋谷の再開発で経営者が逃げる" }, motifs);
    expect(lyric.score).toBeGreaterThan(0);
    const buckets = lyric.matched.map((m) => m.bucket);
    expect(buckets).toContain("geographies");
    expect(buckets).toContain("themes");
    expect(buckets).toContain("vocabulary");
  });

  it("penalizes entries that hit the avoid bucket", () => {
    const promo = scoreObservation({ text: "副業で月100万稼げる" }, motifs);
    expect(promo.avoidHits.length).toBeGreaterThan(0);
    expect(promo.score).toBeLessThan(0);
  });

  it("prefers ranked aligned entries over unrelated entries when motifs exist", () => {
    const entries = [
      { text: "今日の天気は晴れ" },
      { text: "渋谷で再開発の説明会" },
      { text: "ブルックリンのジャズクラブが閉店" }
    ];
    const ranked = rankObservations(entries, motifs);
    expect(ranked.length).toBe(2);
    expect(ranked[0].entry.text).toContain("渋谷");
    expect(ranked.every((item) => item.matched.length > 0)).toBe(true);
  });

  it("falls back to first entries when motifs are empty", () => {
    const empty: PersonaMotifBundle = {
      themes: [],
      vocabulary: [],
      geographies: [],
      sound: [],
      avoid: [],
      raw: ""
    };
    const entries = [
      { text: "first" },
      { text: "second" },
      { text: "third" }
    ];
    const ranked = rankObservations(entries, empty);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].entry.text).toBe("first");
  });

  it("falls back when no entry hits the motif buckets", () => {
    const entries = [
      { text: "完全に無関係なテキスト" },
      { text: "別の無関係なテキスト" }
    ];
    const ranked = rankObservations(entries, motifs);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    expect(ranked[0].matched).toEqual([]);
  });

  it("summarizes matched motifs as a single line", () => {
    const scored = scoreObservation({ text: "渋谷の再開発で経営者が逃げる" }, motifs);
    const summary = summarizeMatches(scored);
    expect(summary).toContain("themes:");
    expect(summary).toContain("geographies:");
  });
});
