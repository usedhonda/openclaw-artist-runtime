import { describe, expect, it } from "vitest";
import { buildNewsReactionQueries } from "../src/services/newsReactionQuery";

describe("news reaction query builder", () => {
  it("starts with phrases and keeps the OR soup as the final fallback", () => {
    const plan = buildNewsReactionQueries([{
      text: "LUUP 事故、渋谷で発生。都市の安全感覚が揺れている",
      url: "https://example.test/luup",
      source: "Example"
    }], { now: new Date("2026-07-01T00:00:00.000Z") });

    expect(plan.seed).toMatchObject({
      title: "LUUP 事故、渋谷で発生。都市の安全感覚が揺れている",
      url: "https://example.test/luup",
      source: "Example"
    });
    expect(plan.queries[0]).toMatch(/^".+"/);
    expect(plan.queries[0]).toContain("LUUP 事故");
    expect(plan.queries.some((query) => query.includes("lang:ja since:2026-06-24"))).toBe(true);
    expect(plan.queries.at(-1)).toBe("LUUP OR 事故 OR 渋谷で発生 OR 都市の安全感覚が揺れている");
  });

  it("preserves compact compounds and acronyms as phrase candidates", () => {
    const plan = buildNewsReactionQueries([{
      text: "NHKがOpenAI連携を発表、LUUP事故報道にもAI要約を導入",
      source: "Tech News"
    }], { now: new Date("2026-07-01T00:00:00.000Z") });

    expect(plan.queries.join("\n")).toContain("NHK");
    expect(plan.queries.join("\n")).toContain("OpenAI");
    expect(plan.queries.join("\n")).toContain("LUUP事故報道にもAI要約を導入");
    expect(plan.queries.at(-1)).not.toBe("NHK OR OpenAI OR LUUP OR 事故");
  });

  it("keeps persona motifs out of the first query and uses them only as a later variant", () => {
    const plan = buildNewsReactionQueries([{
      text: "駅前再開発で小劇場が閉館",
      source: "City News"
    }], {
      now: new Date("2026-07-01T00:00:00.000Z"),
      personaText: "## Geographies\n渋谷\n## Lyrics\n- テーマ: brand-safe\n- テーマ: 再開発"
    });

    expect(plan.queries[0]).not.toContain("brand-safe");
    expect(plan.queries.some((query) => query.includes("brand-safe") || query.includes("渋谷"))).toBe(true);
  });
});
