import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  aggregateCreativeQuality,
  appendCreativeQualityEntry,
  computeDissBankHits,
  creativeQualityLedgerPath,
  extractDissBankItems,
  materialPhrasesUsed,
  readCreativeQualityLedger,
  readLatestCreativeQualityEntry,
  readRecentCreativeDecisions,
  type CreativeQualityEntry
} from "../src/services/creativeQualityLedger";
import { INTRO_ARCHETYPE_IDS, resolveIntroVariant } from "../src/services/creativeVariationPolicy";
import { writeSongPlan } from "../src/services/songPlan";
import type { CreativeDecision } from "../src/types";

const { callAiProviderMock } = vi.hoisted(() => ({
  callAiProviderMock: vi.fn()
}));

vi.mock("../src/services/aiProviderClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/aiProviderClient")>();
  return {
    ...actual,
    callAiProvider: callAiProviderMock
  };
});

const { draftLyrics } = await import("../src/services/lyricsDrafting");

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-creative-quality-"));
}

function entry(overrides: Partial<CreativeQualityEntry> = {}): CreativeQualityEntry {
  return {
    songId: "song-001",
    title: "Test",
    createdAt: new Date().toISOString(),
    dopagakiActive: false,
    dopagakiThreshold: 0.4,
    bareLyricsChars: 1200,
    bareLines: 52,
    moodHint: "civic dread pulse",
    dissBankHits: [],
    dissBankHitCount: 0,
    degraded: false,
    ...overrides
  };
}

const BANK_MD = [
  "## Lyrics",
  "",
  "### Shibuya Diss Material Bank",
  "",
  "- 素材の扱い（安全線・前書き）: これは前書きであり素材項目ではない。",
  "- 再開発ビルが作るビル風: 高さのために路地の空気が消えた。",
  "- 逃げ出した若い子の空席: 家賃と広告に負けて世代がいない。",
  "",
  "## Social Voice",
  ""
].join("\n");

async function bankWorkspace(bankMd: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-creative-quality-draft-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "songs", "song-001", "lyrics"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), bankMd, "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "## Current Obsessions\n- civic rooms\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short and unsentimental\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "song.md"), "# Repair Night\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "brief.md"), "civic responsibility leaves the room\n- Mood: sharp satire\n", "utf8");
  return root;
}

// Dense valid draft (>=52 lines, >=1200 chars) that also embeds bank key terms.
function denseDraftWithBankTerms(): string {
  const line = (index: number) => `再開発ビルの街でビル風がなるまだ夜のノイズがきえないから${index}`;
  const many = (count: number) => Array.from({ length: count }, (_, index) => line(index));
  return JSON.stringify({
    title: "Repair Night",
    form: "compact pop",
    sections: [
      { tag: "Intro - muted street image", lines: many(1) },
      { tag: "Verse 1 - tight civic flow", lines: many(16) },
      { tag: "Pre-Hook - pressure turn", lines: many(4) },
      { tag: "Hook - repeated anchor", lines: many(4) },
      { tag: "Verse 2 - detail turn", lines: many(16) },
      { tag: "Pre-Hook 2 - pressure answer", lines: many(4) },
      { tag: "Hook 2 - final anchor", lines: many(4) },
      { tag: "Bridge - thin contrast", lines: many(3) },
      { tag: "Final Hook - final anchor", lines: many(5) },
      { tag: "Outro - hard stop", lines: many(1) }
    ],
    bilingual_hint: "Japanese main text",
    moodHint: "civic dread pulse"
  });
}

describe("creative quality ledger", () => {
  it("appends and reads entries newest-first with an optional limit", async () => {
    const root = workspace();
    await appendCreativeQualityEntry(root, entry({ songId: "a" }));
    await appendCreativeQualityEntry(root, entry({ songId: "b" }));
    await appendCreativeQualityEntry(root, entry({ songId: "c" }));

    const all = await readCreativeQualityLedger(root);
    expect(all.map((item) => item.songId)).toEqual(["c", "b", "a"]);

    const limited = await readCreativeQualityLedger(root, 2);
    expect(limited.map((item) => item.songId)).toEqual(["c", "b"]);
  });

  it("returns [] for a missing ledger and skips corrupt lines", async () => {
    const root = workspace();
    expect(await readCreativeQualityLedger(root)).toEqual([]);
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(creativeQualityLedgerPath(root), `${JSON.stringify(entry({ songId: "ok" }))}\n{bad json\n`, "utf8");
    const parsed = await readCreativeQualityLedger(root);
    expect(parsed.map((item) => item.songId)).toEqual(["ok"]);
  });

  it("records dopagaki on and off and finds the latest per song", async () => {
    const root = workspace();
    await appendCreativeQualityEntry(root, entry({ songId: "s1", dopagakiActive: false }));
    await appendCreativeQualityEntry(root, entry({ songId: "s2", dopagakiActive: true }));
    await appendCreativeQualityEntry(root, entry({ songId: "s1", dopagakiActive: true }));

    const latestS1 = await readLatestCreativeQualityEntry(root, "s1");
    const latestS2 = await readLatestCreativeQualityEntry(root, "s2");
    expect(latestS1?.dopagakiActive).toBe(true);
    expect(latestS2?.dopagakiActive).toBe(true);
    expect(await readLatestCreativeQualityEntry(root, "missing")).toBeUndefined();
  });

  it("extracts diss-bank noun phrases and skips the safety preface", () => {
    const items = extractDissBankItems(BANK_MD);
    expect(items).toEqual(["再開発ビルが作るビル風", "逃げ出した若い子の空席"]);
  });

  it("returns [] when the diss-bank section is absent", () => {
    expect(extractDissBankItems("## Lyrics\n- Theme: satire\n")).toEqual([]);
    expect(computeDissBankHits("## Lyrics\n- Theme: satire\n", "ビル風の街")).toEqual([]);
  });

  it("matches bank items by deterministic key-term inclusion", () => {
    expect(computeDissBankHits(BANK_MD, "夜のビル風が路地を抜ける")).toEqual(["再開発ビルが作るビル風"]);
    expect(computeDissBankHits(BANK_MD, "夜の街に空席だけが残る")).toEqual(["逃げ出した若い子の空席"]);
    expect(computeDissBankHits(BANK_MD, "まったく無関係な歌詞")).toEqual([]);
  });

  it("aggregates dopagaki rate and average density over a window", () => {
    const empty = aggregateCreativeQuality([]);
    expect(empty).toEqual({
      sampleSize: 0,
      dopagakiRate: 0,
      averageBareChars: 0,
      averageBareLines: 0,
      averageDissBankHits: 0,
      lensCounts: {},
      emotionalModeCounts: {},
      attackStanceCounts: {},
      disRate: 0,
      decisionSampleSize: 0,
      streaks: []
    });

    const rolling = aggregateCreativeQuality([
      entry({ dopagakiActive: true, bareLyricsChars: 1200, bareLines: 52, dissBankHitCount: 2 }),
      entry({ dopagakiActive: false, bareLyricsChars: 1400, bareLines: 58, dissBankHitCount: 4 }),
      entry({ dopagakiActive: true, bareLyricsChars: 1600, bareLines: 60, dissBankHitCount: 0 }),
      entry({ dopagakiActive: false, bareLyricsChars: 1800, bareLines: 66, dissBankHitCount: 6 })
    ]);
    expect(rolling.sampleSize).toBe(4);
    expect(rolling.dopagakiRate).toBe(0.5);
    expect(rolling.averageBareChars).toBe(1500);
    expect(rolling.averageBareLines).toBe(59);
    expect(rolling.averageDissBankHits).toBe(3);
  });

  it("writes a ledger entry when a draft is confirmed", async () => {
    callAiProviderMock.mockReset();
    callAiProviderMock.mockResolvedValueOnce(denseDraftWithBankTerms());
    const root = await bankWorkspace(BANK_MD);

    await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" });

    const ledger = await readCreativeQualityLedger(root);
    expect(ledger).toHaveLength(1);
    const record = ledger[0];
    expect(record.songId).toBe("song-001");
    expect(record.degraded).toBe(false);
    expect(record.bareLines).toBeGreaterThanOrEqual(52);
    expect(record.bareLyricsChars).toBeGreaterThanOrEqual(1200);
    expect(typeof record.dopagakiActive).toBe("boolean");
    expect(record.dissBankHitCount).toBeGreaterThanOrEqual(1);
    expect(record.dissBankHits).toContain("再開発ビルが作るビル風");
    expect(record.hookText).toContain("再開発ビルの街でビル風がなる");
    expect(record.tempoBand).toBe("mid");
    expect(record.emotionalMode).toBe("sharp satire");
  });

  it("consumes the persisted plan: intro, tempo band, mode label, and decision come from song-plan.json", async () => {
    callAiProviderMock.mockReset();
    callAiProviderMock.mockResolvedValue(denseDraftWithBankTerms());
    const root = await bankWorkspace(BANK_MD);

    // The brief says "sharp satire" / no tempo band (resolveTempoBandFromBrief
    // would default to mid); the plan must win on band and mode both.
    const decision: CreativeDecision = {
      version: 1,
      songId: "song-001",
      decidedAt: "2026-08-23T00:00:00.000Z",
      seed: "song-001\n2026-08-23\n",
      lens: "consumption_face",
      lensMaterial: ["整形広告で埋まる駅"],
      attackStance: "数字で殴る",
      emotionalMode: { label: "本気 Dis", spec: "confrontational rap diss" },
      aggression: "dis",
      tempo: { band: "slow", bpm: 88 },
      dopagaki: { active: false, threshold: 0.4, variationSeed: "spacious:song-001:0.9999" },
      intro: {
        archetype: "cold_open",
        modifier: "2 bars, cold open, hard entry, no runway",
        lyricInstruction: "0 lines; enter immediately at full energy with no setup.",
        styleMove: "cold intro, immediate pocket"
      },
      hookShape: "number",
      shibuyaTag: "産地表示",
      signature: ["数字で読む癖"],
      observation: null,
      degradedInputs: [],
      vocalGender: "male"
    };
    await writeSongPlan(root, decision);

    await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" });

    const ledger = await readCreativeQualityLedger(root);
    expect(ledger).toHaveLength(1);
    const record = ledger[0];
    expect(record.introArchetype).toBe("cold_open"); // buildIntroVariantById path
    expect(record.tempoBand).toBe("slow"); // plan.tempo.band, not the brief's mid default
    expect(record.emotionalMode).toBe("本気 Dis"); // plan label, not the brief's "sharp satire"
    expect(record.decision).toEqual(decision); // full decision recorded
  });

  it("logs the artist-led opening contract without rotating a stock archetype", async () => {
    callAiProviderMock.mockReset();
    callAiProviderMock.mockResolvedValueOnce(denseDraftWithBankTerms());
    const root = await bankWorkspace(BANK_MD);

    // A previous artist-led entry must not make the next song select a template.
    const briefText = readFileSync(join(root, "songs", "song-001", "brief.md"), "utf8");
    const barePick = resolveIntroVariant(`intro:song-001\n${briefText}`).id;
    await appendCreativeQualityEntry(root, entry({ songId: "prior", introArchetype: barePick }));

    await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" });

    const ledger = await readCreativeQualityLedger(root);
    expect(ledger[0].songId).toBe("song-001");
    const chosen = ledger[0].introArchetype;
    // Proves the opening contract is recorded (logging wired) ...
    expect(chosen).toBeDefined();
    expect(INTRO_ARCHETYPE_IDS).toContain(chosen);
    expect(chosen).toBe(barePick);
  });
});

function decisionFixture(overrides: Partial<CreativeDecision> = {}): CreativeDecision {
  return {
    version: 1,
    songId: "song-001",
    decidedAt: "2026-08-23T00:00:00.000Z",
    seed: "song-001\n2026-08-23\n",
    lens: "consumption_face",
    lensMaterial: ["整形広告で埋まる駅", "同じ顔の量産ライン"],
    attackStance: "伝票の暴露（原価と単価の差を読み上げる）",
    emotionalMode: { label: "本気 Dis", spec: "confrontational rap diss" },
    aggression: "dis",
    tempo: { band: "up", bpm: 122 },
    dopagaki: { active: false, threshold: 0.4, variationSeed: "spacious:song-001:0.5" },
    intro: { archetype: "scene_set", modifier: "sparse", lyricInstruction: "0-1 line", styleMove: "sparse scene intro" },
    hookShape: "number",
    shibuyaTag: "産地表示",
    signature: ["値段の裏側"],
    observation: null,
    degradedInputs: [],
    vocalGender: "male",
    ...overrides
  };
}

describe("materialPhrasesUsed", () => {
  it("returns phrases that appear verbatim in the lyrics", () => {
    const lyrics = "整形広告で埋まる駅を抜けて\nまだ夜は終わらない";
    expect(materialPhrasesUsed(["整形広告で埋まる駅", "顔のローン"], lyrics)).toEqual(["整形広告で埋まる駅"]);
  });

  it("counts a phrase used when the AI weaves in a key term rather than the whole phrase", () => {
    // "整形広告" is a 2+-char kanji key term (maximal run) of "整形広告で埋まる駅";
    // a term-level hit still counts so usedMaterial is not silently empty when the
    // AI paraphrases instead of quoting the whole noun phrase.
    const lyrics = "整形広告の列に並んで\n数字だけが残る";
    expect(materialPhrasesUsed(["整形広告で埋まる駅"], lyrics)).toEqual(["整形広告で埋まる駅"]);
  });

  it("excludes phrases with no verbatim or key-term match", () => {
    expect(materialPhrasesUsed(["顔のローン"], "まちのノイズがまだきえない")).toEqual([]);
  });
});

describe("readRecentCreativeDecisions material annotation", () => {
  it("annotates decisions with the entry's usedMaterial and leaves older entries unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-recent-used-"));
    await appendCreativeQualityEntry(root, entry({ songId: "old", decision: decisionFixture({ songId: "old" }) }));
    await appendCreativeQualityEntry(
      root,
      entry({ songId: "new", decision: decisionFixture({ songId: "new" }), usedMaterial: ["整形広告で埋まる駅"] })
    );
    const recent = await readRecentCreativeDecisions(root, 6);
    const byId = Object.fromEntries(recent.map((decision) => [decision.songId, decision]));
    expect(byId.new.usedMaterial).toEqual(["整形広告で埋まる駅"]);
    // Older entry lacked usedMaterial; the reader must not fabricate the field.
    expect("usedMaterial" in byId.old).toBe(false);
  });
});
