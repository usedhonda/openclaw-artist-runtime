import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSongState } from "../src/services/artistState";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

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

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-lyrics-repair-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "songs", "song-001", "lyrics"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "used::honda watches civic noise and soft decay.\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "## Current Obsessions\n- civic rooms replaced by chats\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short and unsentimental\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "song.md"), "# Repair Night\n", "utf8");
  await writeFile(join(root, "songs", "song-001", "brief.md"), "government group chats make responsibility leave the room\n", "utf8");
  return root;
}

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");
}

function fieldDraft(lyrics: string): string {
  return [
    "title: Repair Night",
    "lyrics:",
    lyrics.trim(),
    "moodHint: civic dread pulse"
  ].join("\n");
}

function goodJsonDraft(): string {
  const verseOneLines = Array.from({ length: 16 }, (_, index) => `誰も見ない窓にだけ信号が残る 既読の街で責任だけが遅れる ${index % 2 === 0 ? "低いベースが名前を削っていく からの埃がまだ胸で鳴る" : "朝の手前でまだ息を数える からの安全だけ白く剥がれる"}`);
  const verseTwoLines = Array.from({ length: 16 }, (_, index) => `便利な橋ほど足跡を消した 神棚みたいな稟議が白く光る ${index % 2 === 0 ? "笑った顔だけログに残って からのサインが喉を叩く" : "誰の夜かを誰も言わない からの街灯が遅れて瞬く"}`);
  const prehookOneLines = ["逃げた声を追わない", "画面の外で鳴る", "安全のふりだけ白くなる", "まだ角の埃が熱を持つ"];
  const prehookTwoLines = ["錆びた時計が二拍だけずれる", "古い店名が雨でほどける", "遠い通知に街灯が瞬く", "まだ消えないものを拾う"];
  const hookLines = ["逃げた声を追わない", "画面の外で鳴る", "逃げた声を追わない", "拍手より先に埃が立つ"];
  const bridgeLines = ["それでも爪の先だけ熱い", "黙ったまま角を曲がる", "白い壁だけ安全のふりをする", "低いベースが名前を削っていく", "夜明けだけが未送信のまま"];
  return JSON.stringify({
    title: "Repair Night",
    form: "compact pop",
    sections: [
      { tag: "Intro - muted street image", lines: ["駅前の時計だけが少し遅れる"] },
      { tag: "Verse 1 - tight civic flow", lines: verseOneLines },
      { tag: "Pre-Hook - pressure turn", lines: prehookOneLines },
      { tag: "Hook - repeated anchor", lines: hookLines },
      { tag: "Verse 2 - detail turn", lines: verseTwoLines },
      { tag: "Pre-Hook 2 - pressure answer", lines: prehookTwoLines },
      { tag: "Hook 2 - final anchor", lines: hookLines },
      { tag: "Bridge - thin contrast", lines: bridgeLines },
      { tag: "Final Hook - final anchor", lines: [...hookLines, "夜明けだけが未送信のまま"] },
      { tag: "Outro - hard stop", lines: ["夜明けだけが未送信のまま"] }
    ],
    bilingual_hint: "Japanese main text",
    moodHint: "civic dread pulse"
  });
}

// ~1238 bare chars over 58 lines after repair: below the retired 1800-char floor
// but above the calibrated 1200-char / 52-line dual floor, so it must be accepted.
function denseBelowOldFloorDraft(): string {
  const line = (index: number) => `しぶやのよるにさびたひかりがのこるまだ${index}`;
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

// 40 non-marker lines but long enough to clear the 1200-char floor: this must be
// rejected purely on the 52-line floor, proving the line floor is independent.
function fortyLineDraft(): string {
  const line = (index: number) => `しぶやのよるにさびたひかりがのこるまだむねでなるおとがきえないから${index}`;
  const many = (count: number) => Array.from({ length: count }, (_, index) => line(index));
  return JSON.stringify({
    title: "Repair Night",
    form: "compact pop",
    sections: [
      { tag: "Intro - muted street image", lines: many(1) },
      { tag: "Verse 1 - tight civic flow", lines: many(8) },
      { tag: "Pre-Hook - pressure turn", lines: many(4) },
      { tag: "Hook - repeated anchor", lines: many(4) },
      { tag: "Verse 2 - detail turn", lines: many(7) },
      { tag: "Pre-Hook 2 - pressure answer", lines: many(4) },
      { tag: "Hook 2 - final anchor", lines: many(4) },
      { tag: "Bridge - thin contrast", lines: many(3) },
      { tag: "Final Hook - final anchor", lines: many(4) },
      { tag: "Outro - hard stop", lines: many(1) }
    ],
    bilingual_hint: "Japanese main text",
    moodHint: "civic dread pulse"
  });
}

describe("lyrics drafting repair-not-reject orchestration", () => {
  beforeEach(() => {
    callAiProviderMock.mockReset();
  });

  it("accepts a dense provider draft without retrying", async () => {
    const root = await workspace();
    callAiProviderMock.mockResolvedValueOnce(goodJsonDraft());

    const result = await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" });

    expect(callAiProviderMock).toHaveBeenCalledTimes(1);
    expect(result.lyricsText).toContain("[Verse 1 - tight civic flow]");
    expect((await readSongState(root, "song-001")).degradedLyrics).toBe(false);
  });

  it("accepts a ~1238-char draft with 52+ lines that the old 1800 floor would have blocked", async () => {
    const root = await workspace();
    callAiProviderMock.mockResolvedValueOnce(denseBelowOldFloorDraft());

    const result = await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" });

    expect(callAiProviderMock).toHaveBeenCalledTimes(1);
    expect(result.lyricsText).toContain("[Verse 1 - tight civic flow]");
    expect((await readSongState(root, "song-001")).degradedLyrics).toBe(false);
  });

  it("rejects a 40-line draft on the line floor even when the character floor is cleared", async () => {
    const root = await workspace();
    callAiProviderMock.mockResolvedValue(fortyLineDraft());

    let thrown: Error | undefined;
    await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" }).catch((error) => {
      thrown = error as Error;
    });

    expect(callAiProviderMock).toHaveBeenCalledTimes(3);
    const repairNotes = (thrown as { repairNotes?: string[] } | undefined)?.repairNotes ?? [];
    expect(repairNotes.some((note) => /lyrics_too_short_for_duration_plan/.test(note))).toBe(true);
    expect(repairNotes.some((note) => /lines 40\/52/.test(note))).toBe(true);
    expect((await readSongState(root, "song-001")).degradedLyrics).toBe(true);
  });

  it("reprompts up to a valid third draft after repair still fails", async () => {
    const root = await workspace();
    callAiProviderMock
      .mockResolvedValueOnce(fieldDraft(fixture("lyrics-v55-bad-too-short.md")))
      .mockResolvedValueOnce(fieldDraft(fixture("lyrics-v55-bad-too-short.md")))
      .mockResolvedValueOnce(goodJsonDraft());

    const result = await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" });

    expect(callAiProviderMock).toHaveBeenCalledTimes(3);
    expect(result.lyricsText).toContain("[Final Hook - final anchor]");
    expect((await readSongState(root, "song-001")).degradedLyrics).toBe(false);
  });

  it("marks degraded only after deterministic repair and two retries fail", async () => {
    const root = await workspace();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    callAiProviderMock.mockResolvedValue(fieldDraft(fixture("lyrics-v55-bad-too-short.md")));

    let thrown: Error | undefined;
    await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" }).catch((error) => {
      thrown = error as Error;
    });

    expect(callAiProviderMock).toHaveBeenCalledTimes(3);
    const state = await readSongState(root, "song-001");
    const degraded = events.find((event) => event.type === "lyrics_generation_degraded");
    expect(thrown?.message).toContain("lyrics_generation_degraded:");
    expect(state.degradedLyrics).toBe(true);
    expect(state.status).toBe("brief");
    expect(state.lastReason).toBe(thrown?.message);
    expect(degraded).toMatchObject({
      type: "lyrics_generation_degraded",
      reason: thrown?.message,
      detail: expect.any(String),
      repairNotes: expect.arrayContaining([expect.stringContaining("lyrics_too_short_for_duration_plan")])
    });
    if (degraded?.type === "lyrics_generation_degraded") {
      expect(thrown?.message).toContain(degraded.detail);
    }
    unsubscribe();
  });
});
