import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POPULATED_ARTIST_MD, POPULATED_SOUL_MD } from "./helpers/populatedArtistFixtures";

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

import { proposeSpawn } from "../src/services/songSpawnProposer";

const honestMarker = /まだ|言葉になってない|輪郭しか|仮で|これから/;
const fillerPattern = /(.{6,})\1{2,}|いい感じ|うまく/;

function len(value: string): number {
  return Array.from(value).length;
}

function expectComplete(value: string): void {
  expect(len(value)).toBeGreaterThanOrEqual(80);
  expect(len(value)).toBeLessThanOrEqual(220);
  expect(value).toMatch(/[。.?]$/);
  expect(value).not.toMatch(fillerPattern);
}

function expectThin(value: string): void {
  expect(len(value)).toBeGreaterThanOrEqual(30);
  expect(len(value)).toBeLessThanOrEqual(60);
  expect(value).toMatch(honestMarker);
  expect(value).not.toMatch(fillerPattern);
}

async function completeWorkspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-density-full-"));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "SOUL.md"), POPULATED_SOUL_MD, "utf8"),
    writeFile(join(root, "ARTIST.md"), POPULATED_ARTIST_MD, "utf8"),
    writeFile(join(root, "IDENTITY.md"), "# IDENTITY.md\n\nArtist name: Fixture Artist\n", "utf8"),
    writeFile(join(root, "INNER.md"), "# INNER.md\n\nConfigured inner context.\n", "utf8"),
    writeFile(join(root, "PRODUCER.md"), "# PRODUCER.md\n\nConfigured producer context.\n", "utf8")
  ]);
  await writeFile(
    join(root, "observations", "2026-05-10.md"),
    "六本木の古いビルの影で、経営者が若者の声を看板みたいに扱っていた。街の温度だけが一段下がった。\n",
    "utf8"
  );
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  return root;
}

async function thinWorkspace(kind: "source" | "mood"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), `artist-runtime-spawn-density-thin-${kind}-`));
  await mkdir(join(root, "observations"), { recursive: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  if (kind === "source") {
    await writeFile(join(root, "SOUL.md"), POPULATED_SOUL_MD, "utf8");
    await writeFile(join(root, "ARTIST.md"), POPULATED_ARTIST_MD, "utf8");
    await writeFile(join(root, "observations", "2026-05-10.md"), "薄い観察だけが残っている。\n", "utf8");
  } else {
    await writeFile(join(root, "SOUL.md"), "mood: observational\n", "utf8");
    await writeFile(join(root, "ARTIST.md"), "artist core pending\n", "utf8");
    await writeFile(
      join(root, "observations", "2026-05-10.md"),
      "駅前の古い看板だけが残っていて、夜の空気が少しだけ冷えていた。\n",
      "utf8"
    );
  }
  await writeFile(join(root, "runtime", "heartbeat-state.json"), JSON.stringify({ mood: "observational" }), "utf8");
  return root;
}

describe("song spawn proposer pitch density and honest-thin contract", () => {
  beforeEach(() => {
    callAiProviderMock.mockReset();
  });

  it("emits complete 60-120 char pitch fields when source, motif, and fingerprint are complete", async () => {
    const proposal = await proposeSpawn(await completeWorkspace(), {
      aiReviewProvider: "mock",
      now: new Date("2026-05-10T00:00:00.000Z")
    });
    expect(proposal).not.toBeNull();
    expectComplete(proposal!.brief.lyricsTheme);
    expectComplete(proposal!.brief.styleNotes);
    expectComplete(proposal!.reason);
    expect(proposal!.brief.lyricsTheme).toMatch(/サビ|ヴァース|フック/);
    expect(proposal!.brief.styleNotes).toMatch(/bass|drum|hi.?hat|vocals?|sparse|breathing/i);
    expect(proposal!.reason).not.toMatch(honestMarker);
    // v10.25: reason must be anchored to brief.title (not generic observation-only)
    expect(proposal!.reason).toContain(proposal!.brief.title);
  });

  it("rejects voice-fingerprint-violating AI reason and replaces with brief-anchored fallback (v10.25)", async () => {
    callAiProviderMock.mockResolvedValue([
      "spawn: yes",
      "title: Neon Exit Strategy",
      "brief: 渋谷の再開発を、 逃げ場を失った若者と均質化した夜の景色で切る一曲",
      "lyricsTheme: 渋谷の再開発を街の匂いから切る。 サビは「出口だけ光ってる」 のリフレイン、 ヴァースで工事壁、 終電後の空白を積む。 文化が便利さに買われる瞬間。",
      "style: fast live jazz drums, thick electric bass upfront, dusty Rhodes stabs, restrained hi-hats, vocals nestled between instruments, sparse arrangement",
      "mood: tense, late-night, urban decay, dry satire",
      "tempo: 146 BPM",
      "duration: 2:52",
      "reason: 了解しました。 ご確認ください。 申し訳ございません。"
    ].join("\n"));
    const proposal = await proposeSpawn(await completeWorkspace(), {
      aiReviewProvider: "openai-codex",
      now: new Date("2026-05-10T00:00:00.000Z")
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.brief.title).toBe("Neon Exit Strategy");
    // Reason must be brief-anchored, not the previous song's leak.
    expect(proposal!.reason).toContain("Neon Exit Strategy");
    expect(proposal!.reason).not.toContain("六本木");
    expect(proposal!.reason).not.toMatch(/了解しました|ご確認ください|申し訳ございません/);
  });

  it("uses short honest markers when the observation source is too thin", async () => {
    const proposal = await proposeSpawn(await thinWorkspace("source"), {
      aiReviewProvider: "mock",
      now: new Date("2026-05-10T00:00:00.000Z")
    });
    expect(proposal).not.toBeNull();
    expectThin(proposal!.brief.lyricsTheme);
    expectThin(proposal!.brief.styleNotes);
    expectThin(proposal!.reason);
  });

  it("uses short honest markers when only mood-level persona context exists", async () => {
    const proposal = await proposeSpawn(await thinWorkspace("mood"), {
      aiReviewProvider: "mock",
      now: new Date("2026-05-10T00:00:00.000Z")
    });
    expect(proposal).not.toBeNull();
    expectThin(proposal!.brief.lyricsTheme);
    expectThin(proposal!.brief.styleNotes);
    expectThin(proposal!.reason);
  });

  it("rejects AI filler and repeated helper phrases before persisting pitch fields", async () => {
    callAiProviderMock.mockResolvedValue([
      "spawn: yes",
      "title: Filler Test",
      "brief: filler",
      "lyricsTheme: いい感じいい感じいい感じいい感じいい感じいい感じ",
      "style: うまくうまくうまくうまくうまくうまく",
      "reason: これはこれはこれはこれはこれはこれは",
      "mood: tense",
      "tempo: 96 BPM",
      "duration: 3:00"
    ].join("\n"));
    const proposal = await proposeSpawn(await completeWorkspace(), {
      aiReviewProvider: "openai-codex",
      now: new Date("2026-05-10T00:00:00.000Z")
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.brief.lyricsTheme).not.toMatch(fillerPattern);
    expect(proposal!.brief.styleNotes).not.toMatch(fillerPattern);
    expect(proposal!.reason).not.toMatch(fillerPattern);
    expectComplete(proposal!.brief.lyricsTheme);
    expectComplete(proposal!.brief.styleNotes);
    expectComplete(proposal!.reason);
    expect(proposal!.brief.lyricsTheme).toMatch(/サビ|ヴァース|フック/);
    expect(proposal!.brief.styleNotes).toMatch(/bass|drum|hi.?hat|vocals?|sparse|breathing/i);
  });
});
