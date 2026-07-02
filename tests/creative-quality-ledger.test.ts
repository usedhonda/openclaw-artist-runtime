import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateCreativeQuality,
  appendCreativeQualityEntry,
  computeDissBankHits,
  creativeQualityLedgerPath,
  extractDissBankItems,
  readCreativeQualityLedger,
  readLatestCreativeQualityEntry,
  type CreativeQualityEntry
} from "../src/services/creativeQualityLedger";

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
  await writeFile(join(root, "songs", "song-001", "brief.md"), "civic responsibility leaves the room\n", "utf8");
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
    expect(empty).toEqual({ sampleSize: 0, dopagakiRate: 0, averageBareChars: 0, averageBareLines: 0, averageDissBankHits: 0 });

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
  });
});
