import { describe, expect, it } from "vitest";
import { buildNewsReactionQueries } from "../src/services/newsReactionQuery";

const shibuyaPersona = "## Geographies\n渋谷\n原宿";

describe("news reaction query builder", () => {
  it("decomposes today's real 西武渋谷 headline into a no-quote geo-anchored ladder", () => {
    const plan = buildNewsReactionQueries([{
      text: "まさか渋谷まで！ 西武渋谷店も閉店へ 百貨店58社の8割超が「減収」に沈むワケ | ダイヤモンド・オンライン",
      url: "https://example.test/seibu",
      source: "Diamond"
    }], { personaText: shibuyaPersona });

    // No rung is an exact-quoted phrase; the old builder emitted `"...長い見出し..."`.
    expect(plan.queries.every((query) => !query.includes('"'))).toBe(true);
    // The outlet suffix and numeric counters are stripped, not searched.
    expect(plan.queries.join("\n")).not.toMatch(/ダイヤモンド|オンライン|8割超|58社/);
    // Rung a: the geo-anchored specific pair rescued by geo-padding.
    expect(plan.queries[0]).toBe("西武 渋谷");
    // Rung b: same pair scoped to Japanese.
    expect(plan.queries[1]).toBe("西武 渋谷 lang:ja");
    // Rung c: broader topic + geo fallback.
    expect(plan.queries.at(-1)).toBe("閉店 渋谷");
    expect(plan.seed).toMatchObject({
      title: "まさか渋谷まで！ 西武渋谷店も閉店へ 百貨店58社の8割超が「減収」に沈むワケ | ダイヤモンド・オンライン",
      url: "https://example.test/seibu",
      source: "Diamond"
    });
  });

  it("strips a PR TIMES source suffix and keeps a stable ladder order", () => {
    const plan = buildNewsReactionQueries([{
      text: "渋谷の新スタートアップが資金調達、10億円規模の新ファンドを組成｜PR TIMES",
      source: "PR TIMES"
    }], { personaText: shibuyaPersona });

    expect(plan.queries.every((query) => !query.includes('"'))).toBe(true);
    expect(plan.queries.join("\n")).not.toMatch(/PR TIMES|10億円/);
    expect(plan.queries[0]).toBe("渋谷 資金調達");
    expect(plan.queries[1]).toBe("渋谷 資金調達 lang:ja");
    // Rung order is stable: specific pair, then lang-scoped, then the broad rung.
    expect(plan.queries[1].endsWith(" lang:ja")).toBe(true);
  });

  it("builds a decomposed ladder without persona geographies", () => {
    const plan = buildNewsReactionQueries([{
      text: "まさか渋谷まで！ 西武渋谷店も閉店へ 百貨店58社の8割超が「減収」に沈むワケ | ダイヤモンド・オンライン",
      source: "Diamond"
    }]);

    expect(plan.queries.every((query) => !query.includes('"'))).toBe(true);
    // Without a geo term, rung a falls back to two topic tokens.
    expect(plan.queries[0]).toBe("閉店 百貨店");
    expect(plan.queries[1]).toBe("閉店 百貨店 lang:ja");
    expect(plan.queries.length).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty plan when there is no usable entry", () => {
    expect(buildNewsReactionQueries([]).queries).toEqual([]);
    expect(buildNewsReactionQueries([{ text: "   ", source: "S" }]).queries).toEqual([]);
  });
});
