import { describe, expect, it } from "vitest";
import { planQueryStrategy } from "../src/services/xQueryStrategyPlanner";

describe("x query strategy planner", () => {
  it("classifies news-like hints as topical", async () => {
    const strategy = await planQueryStrategy({ manualSeed: { hint: "最新ニュースから曲作って" } });

    expect(strategy).toMatchObject({ mode: "topical", recencyWindow: 24 });
    expect(strategy.query).toContain("最新ニュース");
  });

  it("classifies evergreen hints as evergreen", async () => {
    const strategy = await planQueryStrategy({ manualSeed: { hint: "普遍的で永遠の孤独" } });

    expect(strategy.mode).toBe("evergreen");
    expect(strategy.recencyWindow).toBeUndefined();
  });

  it("uses mock topical fallback with persona context", async () => {
    const strategy = await planQueryStrategy({ personaText: "社会風刺と短い言葉。渋谷を失敗した都市模型として切る。" });

    expect(strategy.mode).toBe("topical");
    expect(strategy.recencyWindow).toBe(24);
    expect(strategy.query).toContain("ニュース");
    expect(strategy.query).not.toContain("渋谷");
    expect(strategy.motifKeywords).toContain("渋谷");
  });

  it("rejects secret-like hints", async () => {
    await expect(planQueryStrategy({ manualSeed: { hint: "API_KEY=do-not-store" } })).rejects.toThrow("secret");
  });
});
