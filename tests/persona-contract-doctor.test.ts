import { afterEach, describe, expect, it } from "vitest";
import {
  diagnoseAndReportPersonaContract,
  diagnosePersonaContract,
  resetPersonaContractDoctorMemoForTest
} from "../src/services/personaContractDoctor";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

// A persona fixture that mirrors the live ARTIST.md canon structure closely
// enough that all six doctor checks pass. Each `renameHeading` / `stripSignature`
// mutation degrades exactly one check.
const CANON = [
  "# ARTIST.md",
  "",
  "## Current Artist Core",
  "",
  "- Signature: 値段の裏側, 舞台裏の視界, 高さと時間帯, 当事者の自覚, 数字で読む癖",
  "",
  "### Critique Lens",
  "",
  "- [consumption_face] 消費と顔: 主レンズを一つ選び、観察をそのレンズの舞台裏へ着地させる。",
  "- [net_generation] ネットと世代: ネットの熱量と世代間断絶を追う。",
  "- [shibuya_city] 渋谷と都市: 都市の再開発と広告を追う。",
  "- 撃つ対象は流行、スタイル、産業。実名の個人は撃たない。",
  "",
  "### Emotional Modes",
  "",
  "- 本気 Dis: confrontational rap diss, head-on, sharp, dry menace",
  "- 郷愁: nostalgic, warm-cold, late-night recall",
  "- 祝祭: celebratory, crowd heat, mocking joy",
  "- 自嘲: self-mocking, implicated, wry, tired money",
  "- 賛美: praising, earnest under sarcasm, rare warmth",
  "- 静かな肯定: quiet affirmation, 5am calm, low light",
  "- 困惑: bewildered, off-balance, curious, numbers failing",
  "",
  "### Tag Techniques",
  "",
  "- 技法の扱い(前書き): 住所として扱う技法集。前書きなので数えない。",
  "- 一言タグ: どこか一行だけ貼る。",
  "- 産地表示: 製造元を明かす。産地ラベルを貼る。",
  "- 単位化: 数の単位にする。",
  "- 診断名: 症状の名前にする。",
  "",
  "### Attack Stances",
  "",
  "- 攻め筋の扱い(前書き): 刺し方を毎曲変える。前書きなので数えない。",
  "- [consumption_face]: 名指しの挑発 / 実況中継 / 伝票の暴露 / 院長の独白パロディ / 群れへの説教",
  "- [net_generation]: 数字で殴る / 中の人の暴露 / 速度への挑発 / 翻訳の刃 / 未来完了形",
  "- [shibuya_city]: 見下ろしの査定 / 案内放送パロディ / 住民票の点呼 / 昔の渋谷の亡霊 / 工事音のリズム",
  "",
  "## Sound",
  "",
  "### Material Bank: consumption_face",
  "",
  "- 素材の扱い(前書き): これは前書きであり素材項目ではない。",
  "- 整形広告で埋まる駅: 街の入口が顔のカタログになった。",
  "- 同じ顔の量産ライン: 工場の検品を通った顔。",
  "- 顔のローン: 医療ローンで買った輪郭。",
  "",
  "### Material Bank: net_generation",
  "",
  "- 素材の扱い(前書き): これは前書きであり素材項目ではない。",
  "- 炎上の賞味期限: 三日で冷めて在庫になる怒り。",
  "- 十五秒の寿命: 十五秒が一曲の値段になる。",
  "- 推し活の損益: 会計だけが正直。",
  "",
  "### Material Bank: shibuya_city",
  "",
  "- 素材の扱い(前書き): これは前書きであり素材項目ではない。",
  "- 街に上書きされる他所の言葉: 誰のための通りか分からなくなる音風景。",
  "- 逃げ出した若い子の空席: 最初に街を作った世代がもういない。",
  "- 再開発ビルが作るビル風: 風だけが強くなった街。",
  ""
].join("\n");

function renameHeading(text: string, heading: string, replacement: string): string {
  return text.replace(heading, replacement);
}

function checkById(report: ReturnType<typeof diagnosePersonaContract>, id: string) {
  const check = report.checks.find((entry) => entry.id === id);
  if (!check) throw new Error(`check ${id} missing`);
  return check;
}

describe("persona contract doctor", () => {
  afterEach(() => {
    resetPersonaContractDoctorMemoForTest();
    getRuntimeEventBus().clearForTest();
  });

  it("passes every check on a canon-structured fixture", () => {
    const report = diagnosePersonaContract(CANON);
    expect(report.ok).toBe(true);
    expect(report.degraded).toEqual([]);
    expect(report.checks.map((check) => check.id).sort()).toEqual(
      ["attack_stances", "critique_lens", "emotional_modes", "material_banks", "tag_techniques", "signatures"].sort()
    );
    for (const check of report.checks) {
      expect(check.ok).toBe(true);
    }
  });

  it("fails material_banks when a bank heading is renamed", () => {
    const report = diagnosePersonaContract(
      renameHeading(CANON, "### Material Bank: net_generation", "### Net Stuff")
    );
    expect(checkById(report, "material_banks").ok).toBe(false);
    expect(report.degraded).toContain("material_banks");
  });

  it("fails material_banks when no lens is declared at all", () => {
    const report = diagnosePersonaContract(renameHeading(CANON, "### Critique Lens", "### Angle"));
    expect(checkById(report, "material_banks").ok).toBe(false);
  });

  it("fails emotional_modes when the heading is renamed (fallback is 6 modes, no Dis)", () => {
    const report = diagnosePersonaContract(renameHeading(CANON, "### Emotional Modes", "### Feelings"));
    const check = checkById(report, "emotional_modes");
    expect(check.ok).toBe(false);
    expect(report.degraded).toContain("emotional_modes");
  });

  it("fails critique_lens when the heading is renamed", () => {
    const report = diagnosePersonaContract(renameHeading(CANON, "### Critique Lens", "### Angle"));
    expect(checkById(report, "critique_lens").ok).toBe(false);
  });

  it("fails attack_stances when the heading is renamed", () => {
    const report = diagnosePersonaContract(renameHeading(CANON, "### Attack Stances", "### Moves"));
    expect(checkById(report, "attack_stances").ok).toBe(false);
  });

  it("fails tag_techniques when the heading is renamed", () => {
    const report = diagnosePersonaContract(
      renameHeading(CANON, "### Tag Techniques", "### Tags")
    );
    expect(checkById(report, "tag_techniques").ok).toBe(false);
  });

  it("fails signatures when the canon no longer mentions Signature", () => {
    const stripped = CANON.replace(/Signature/g, "署名");
    const report = diagnosePersonaContract(stripped);
    expect(checkById(report, "signatures").ok).toBe(false);
  });

  it("material_banks passes with exactly two declared lenses, each with a non-empty bank", () => {
    const persona = [
      "### Critique Lens",
      "- [a] Lens A: description.",
      "- [b] Lens B: description.",
      "### Material Bank: a",
      "- item one: detail.",
      "### Material Bank: b",
      "- item two: detail."
    ].join("\n");
    const report = diagnosePersonaContract(persona);
    expect(checkById(report, "material_banks").ok).toBe(true);
  });

  it("material_banks fails when one declared lens has no material bank", () => {
    const persona = [
      "### Critique Lens",
      "- [a] Lens A: description.",
      "- [b] Lens B: description.",
      "### Material Bank: a",
      "- item one: detail."
    ].join("\n");
    const report = diagnosePersonaContract(persona);
    const check = checkById(report, "material_banks");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("a=1");
    expect(check.detail).toContain("b=0");
  });

  it("emits persona_contract_degraded once per distinct failing-check set", () => {
    const events: RuntimeEvent[] = [];
    getRuntimeEventBus().subscribe((event) => {
      if (event.type === "persona_contract_degraded") events.push(event);
    });
    const degradedText = renameHeading(CANON, "### Emotional Modes", "### Feelings");

    diagnoseAndReportPersonaContract(degradedText);
    diagnoseAndReportPersonaContract(degradedText);
    expect(events).toHaveLength(1);
    expect((events[0] as Extract<RuntimeEvent, { type: "persona_contract_degraded" }>).degraded).toContain(
      "emotional_modes"
    );

    // A different failing set fires again.
    const twoBroken = renameHeading(degradedText, "### Attack Stances", "### Moves");
    diagnoseAndReportPersonaContract(twoBroken);
    expect(events).toHaveLength(2);
  });

  it("does not emit when the contract holds", () => {
    const events: RuntimeEvent[] = [];
    getRuntimeEventBus().subscribe((event) => {
      if (event.type === "persona_contract_degraded") events.push(event);
    });
    const report = diagnoseAndReportPersonaContract(CANON);
    expect(report.ok).toBe(true);
    expect(events).toHaveLength(0);
  });
});
