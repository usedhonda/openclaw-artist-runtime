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
  "### Critique Lens",
  "",
  "- 主レンズを一つ選び、観察をそのレンズの舞台裏へ着地させる。",
  "- どのレンズでも、Signature の五種のうち一つ以上を歌詞に残す。",
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
  "### Shibuya Tag Techniques",
  "",
  "- 技法の扱い(前書き): 渋谷を住所として扱う技法集。前書きなので数えない。",
  "- 一言タグ: どこか一行だけ渋谷を貼る。",
  "- 産地表示: 製造元、渋谷。産地ラベルを貼る。",
  "- 単位化: 渋谷を数の単位にする。",
  "- 診断名: 症状の名前が渋谷。",
  "- 地名の代入: 別の街の出来事を渋谷の〇〇と言い換える。",
  "- 住民登録: 刺す相手を全員渋谷の住人にする。",
  "- 最後の一撃: 最終フックの一行だけで渋谷に着地させる。",
  "- 時間差: 昔の渋谷、五年後の渋谷。",
  "- 翻訳: ネットの言葉を渋谷語に訳し直す。",
  "- 見下ろし: 六本木の高さからの一行。",
  "",
  "### Attack Stances",
  "",
  "- 攻め筋の扱い(前書き): 刺し方を毎曲変える。前書きなので数えない。",
  "- A 消費と顔: 名指しの挑発 / 実況中継 / 伝票の暴露 / 院長の独白パロディ / 群れへの説教",
  "- B ネットと世代: 数字で殴る / 中の人の暴露 / 速度への挑発 / 翻訳の刃 / 未来完了形",
  "- C 渋谷と都市: 見下ろしの査定 / 案内放送パロディ / 住民票の点呼 / 昔の渋谷の亡霊 / 工事音のリズム",
  "",
  "## Sound",
  "",
  "- Signature section logic: leave one Signature line only the man at the top floor could write.",
  "",
  "### Consumption & Face Material Bank",
  "",
  "- 素材の扱い(前書き): これは前書きであり素材項目ではない。",
  "- 整形広告で埋まる駅: 街の入口が顔のカタログになった。",
  "- 同じ顔の量産ライン: 工場の検品を通った顔。",
  "- 顔のローン: 医療ローンで買った輪郭。",
  "",
  "### Net & Generation Material Bank",
  "",
  "- 素材の扱い(前書き): これは前書きであり素材項目ではない。",
  "- 炎上の賞味期限: 三日で冷めて在庫になる怒り。",
  "- 十五秒の寿命: 十五秒が一曲の値段になる。",
  "- 推し活の損益: 会計だけが正直。",
  "",
  "### Shibuya Diss Material Bank",
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
      ["attack_stances", "critique_lens", "emotional_modes", "material_banks", "shibuya_tag_techniques", "signatures"].sort()
    );
    for (const check of report.checks) {
      expect(check.ok).toBe(true);
    }
  });

  it("fails material_banks when a bank heading is renamed", () => {
    const report = diagnosePersonaContract(
      renameHeading(CANON, "### Net & Generation Material Bank", "### Net Stuff")
    );
    expect(checkById(report, "material_banks").ok).toBe(false);
    expect(report.degraded).toContain("material_banks");
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

  it("fails shibuya_tag_techniques when the heading is renamed", () => {
    const report = diagnosePersonaContract(
      renameHeading(CANON, "### Shibuya Tag Techniques", "### Tags")
    );
    expect(checkById(report, "shibuya_tag_techniques").ok).toBe(false);
  });

  it("fails signatures when the canon no longer mentions Signature", () => {
    const stripped = CANON.replace(/Signature/g, "署名");
    const report = diagnosePersonaContract(stripped);
    expect(checkById(report, "signatures").ok).toBe(false);
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
