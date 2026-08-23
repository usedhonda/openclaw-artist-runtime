import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideCreative, type CreativeDirectorInput } from "../src/services/creativeDirector.js";
import { readSongPlan, writeSongPlan } from "../src/services/songPlan.js";
import {
  appendCreativeQualityEntry,
  readRecentCreativeDecisions,
  type CreativeQualityEntry
} from "../src/services/creativeQualityLedger.js";
import type { CreativeDecision } from "../src/types.js";

// Persona fixture with every rotation section the director reads: three material
// banks (=== lens banks), Emotional Modes including 本気 Dis, Shibuya Tag
// Techniques, and a vocalGender line. `### Attack Stances` is intentionally
// absent (the canon adds it in F4) so the built-in fallback + degraded flag path
// is exercised.
const PERSONA = `# Artist

## Sound

- Vocal identity: vocalGender: male; dry mid-range.

### Emotional Modes

- 本気 Dis: confrontational rap diss, head-on, sharp, dry menace
- 郷愁: nostalgic, warm-cold, late-night recall
- 祝祭: celebratory, crowd heat, bright pressure
- 自嘲: self-mocking, implicated, wry
- 賛美: praising, earnest under sarcasm
- 静かな肯定: quiet affirmation, low light, steady
- 困惑: bewildered, off-balance, numbers failing

### Shibuya Tag Techniques

- 技法の扱い(前書き): 渋谷を貼れる住所として扱う技法集。
- 一言タグ: どこか一行だけ渋谷を貼る。
- 産地表示: 製造元、渋谷。
- 単位化: 渋谷を数の単位にする。
- 診断名: 診断、渋谷。

### Consumption & Face Material Bank

- 素材の扱い(前書き): 撃つのは仕組み。
- 整形広告で埋まる駅: 顔のカタログ。
- 同じ顔の量産ライン: 工場の検品を通った顔。
- 顔のローン: 医療ローンで買った輪郭。

### Net & Generation Material Bank

- 素材の扱い(前書き): 撃つのは速度。
- 炎上の賞味期限: 三日で在庫になる怒り。
- 十五秒の寿命: 十五秒が一曲の値段。

### Shibuya Diss Material Bank

- 素材の扱い(安全線): 矛先は都市の仕組みへ。
- 街に上書きされる他所の言葉: 誰のための通りか。
- スクランブルを埋める自撮り棒: 渡る場所から撮る場所へ。
`;

function baseInput(overrides: Partial<CreativeDirectorInput> = {}): CreativeDirectorInput {
  return {
    songId: "song-001",
    jstDate: "2026-08-23",
    personaText: PERSONA,
    observation: { url: "https://x.com/a/status/1", author: "a", motifScore: 5, text: "seed" },
    recentDecisions: [],
    ...overrides
  };
}

// Feed history sequentially: decide song N, append it, then decide song N+1 with
// the accumulated history (most-recent last, windowed to 6).
function simulate(count: number, personaText = PERSONA): CreativeDecision[] {
  const history: CreativeDecision[] = [];
  for (let index = 0; index < count; index += 1) {
    const decision = decideCreative({
      songId: `song-${String(index).padStart(3, "0")}`,
      jstDate: "2026-08-23",
      personaText,
      observation: null,
      recentDecisions: history.slice(-6)
    });
    history.push(decision);
  }
  return history;
}

describe("creativeDirector.decideCreative", () => {
  it("is deterministic: same input yields the same decision", () => {
    const input = baseInput();
    expect(decideCreative(input)).toEqual(decideCreative(input));
  });

  it("keeps aggression on Dis for ~80% of songs with no consecutive changeups", () => {
    const history = simulate(500);
    const disCount = history.filter((decision) => decision.aggression === "dis").length;
    expect(disCount / history.length).toBeGreaterThanOrEqual(0.75);
    for (let index = 1; index < history.length; index += 1) {
      const bothChangeup = history[index].aggression === "changeup" && history[index - 1].aggression === "changeup";
      expect(bothChangeup).toBe(false);
    }
    // every dis song carries the 本気 Dis mode
    for (const decision of history) {
      if (decision.aggression === "dis") expect(decision.emotionalMode.label).toBe("本気 Dis");
    }
  });

  it("never repeats a lens back-to-back and never runs a lens 3 in a row", () => {
    const history = simulate(60);
    for (let index = 1; index < history.length; index += 1) {
      expect(history[index].lens).not.toBe(history[index - 1].lens);
    }
    for (let index = 2; index < history.length; index += 1) {
      const threeInARow = history[index].lens === history[index - 1].lens && history[index - 1].lens === history[index - 2].lens;
      expect(threeInARow).toBe(false);
    }
  });

  it("excludes the previous value on each rotated axis", () => {
    const history = simulate(40);
    for (let index = 1; index < history.length; index += 1) {
      expect(history[index].hookShape).not.toBe(history[index - 1].hookShape);
      expect(history[index].shibuyaTag).not.toBe(history[index - 1].shibuyaTag);
      expect(history[index].attackStance).not.toBe(history[index - 1].attackStance);
      expect(history[index].signature[0]).not.toBe(history[index - 1].signature[0]);
    }
  });

  it("only uses material from the chosen lens's bank", () => {
    const decision = decideCreative(baseInput());
    expect(decision.lensMaterial.length).toBeGreaterThan(0);
    expect(decision.lensMaterial.length).toBeLessThanOrEqual(12);
    // preface bullets (素材の扱い) are never treated as material
    expect(decision.lensMaterial.some((noun) => noun.startsWith("素材の扱い"))).toBe(false);
  });

  it("records degradedInputs when persona sections and observation are missing", () => {
    const decision = decideCreative(
      baseInput({ personaText: "# empty persona\n", observation: null })
    );
    expect(decision.degradedInputs).toContain("observation_null");
    expect(decision.degradedInputs).toContain("material_banks_empty");
    expect(decision.degradedInputs).toContain("emotional_modes_missing_dis");
    expect(decision.degradedInputs).toContain("tag_techniques_missing");
    expect(decision.degradedInputs).toContain("attack_stances_missing");
  });

  it("flags attack_stances_missing while the canon section is absent but still assigns a stance", () => {
    const decision = decideCreative(baseInput());
    expect(decision.degradedInputs).toContain("attack_stances_missing");
    expect(decision.attackStance.length).toBeGreaterThan(0);
  });

  it("reads vocalGender from the persona", () => {
    expect(decideCreative(baseInput()).vocalGender).toBe("male");
  });
});

describe("songPlan persistence", () => {
  it("writes once and returns the existing plan on a second write", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-plan-"));
    const first = decideCreative(baseInput());
    const second = decideCreative(baseInput({ jstDate: "2099-01-01" })); // different decision, same songId
    expect(second.seed).not.toBe(first.seed);
    const written = await writeSongPlan(root, first);
    expect(written).toEqual(first);
    const rewritten = await writeSongPlan(root, second);
    expect(rewritten).toEqual(first); // write-once: original wins
    const read = await readSongPlan(root, first.songId);
    expect(read).toEqual(first);
  });

  it("returns undefined for a song without a plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-plan-"));
    expect(await readSongPlan(root, "song-999")).toBeUndefined();
  });

  it("threads the single dopagaki decision through the plan file", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-plan-"));
    const decision = decideCreative(baseInput());
    await writeSongPlan(root, decision);
    // What lyricsDrafting / autopilot / retry read back must equal the one decision.
    const consumed = await readSongPlan(root, decision.songId);
    expect(consumed?.dopagaki.variationSeed).toBe(decision.dopagaki.variationSeed);
    expect(consumed?.dopagaki.active).toBe(decision.dopagaki.active);
  });
});

describe("readRecentCreativeDecisions", () => {
  it("returns decisions most-recent last and skips entries without a decision", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-recent-decisions-"));
    const decisions = simulate(3).map((decision, index) => ({ ...decision, songId: `song-${index}` }));
    // append in creation order; a legacy entry (no decision) sits in the middle
    await appendEntry(root, "song-0", decisions[0]);
    await appendEntry(root, "legacy", undefined);
    await appendEntry(root, "song-1", decisions[1]);
    await appendEntry(root, "song-2", decisions[2]);
    const recent = await readRecentCreativeDecisions(root, 6);
    expect(recent.map((decision) => decision.songId)).toEqual(["song-0", "song-1", "song-2"]);
  });
});

async function appendEntry(root: string, songId: string, decision: CreativeDecision | undefined): Promise<void> {
  const entry: CreativeQualityEntry = {
    songId,
    title: songId,
    createdAt: new Date().toISOString(),
    dopagakiActive: false,
    dopagakiThreshold: 0.4,
    bareLyricsChars: 0,
    bareLines: 0,
    moodHint: "",
    decision,
    dissBankHits: [],
    dissBankHitCount: 0,
    degraded: false
  };
  await appendCreativeQualityEntry(root, entry);
}
