import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSongState } from "../src/services/artistState";

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
  return JSON.stringify({
    title: "Repair Night",
    form: "compact pop",
    sections: [
      { tag: "Intro - muted street image", lines: ["駅前の時計だけが少し遅れる"] },
      { tag: "Verse 1 - tight civic flow", lines: ["誰も見ない窓にだけ信号が残る", "既読の街で責任だけが遅れる", "低いベースが名前を削っていく", "朝の手前でまだ息を数える"] },
      { tag: "Hook - repeated anchor", lines: ["逃げた声を追わない", "画面の外で鳴る", "逃げた声を追わない"] },
      { tag: "Verse 2 - detail turn", lines: ["便利な橋ほど足跡を消した", "神棚みたいな稟議が白く光る", "笑った顔だけログに残って", "誰の夜かを誰も言わない"] },
      { tag: "Bridge - thin contrast", lines: ["それでも爪の先だけ熱い", "黙ったまま角を曲がる"] },
      { tag: "Verse 3 - consequence", lines: ["錆びた時計が二拍だけずれる", "古い店名が雨でほどける", "遠い通知に街灯が瞬く", "まだ消えないものを拾う"] },
      { tag: "Hook - final anchor", lines: ["逃げた声を追わない", "画面の外で鳴る", "逃げた声を追わない"] },
      { tag: "Outro - hard stop", lines: ["夜明けだけが未送信のまま"] }
    ],
    bilingual_hint: "Japanese main text",
    moodHint: "civic dread pulse"
  });
}

describe("lyrics drafting repair-not-reject orchestration", () => {
  beforeEach(() => {
    callAiProviderMock.mockReset();
  });

  it("repairs a structurally rough provider draft without retrying", async () => {
    const root = await workspace();
    callAiProviderMock.mockResolvedValueOnce(fieldDraft(fixture("lyrics-v55-bad-no-tags.md")));

    const result = await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" });

    expect(callAiProviderMock).toHaveBeenCalledTimes(1);
    expect(result.lyricsText).toContain("[Verse 1 - tight flow]");
    expect((await readSongState(root, "song-001")).degradedLyrics).toBe(false);
  });

  it("reprompts up to a valid third draft after repair still fails", async () => {
    const root = await workspace();
    callAiProviderMock
      .mockResolvedValueOnce(fieldDraft(fixture("lyrics-v55-bad-too-short.md")))
      .mockResolvedValueOnce(fieldDraft(fixture("lyrics-v55-bad-too-short.md")))
      .mockResolvedValueOnce(goodJsonDraft());

    const result = await draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" });

    expect(callAiProviderMock).toHaveBeenCalledTimes(3);
    expect(result.lyricsText).toContain("[Hook - final anchor]");
    expect((await readSongState(root, "song-001")).degradedLyrics).toBe(false);
  });

  it("marks degraded only after deterministic repair and two retries fail", async () => {
    const root = await workspace();
    callAiProviderMock.mockResolvedValue(fieldDraft(fixture("lyrics-v55-bad-too-short.md")));

    await expect(draftLyrics({ workspaceRoot: root, songId: "song-001", aiReviewProvider: "openai-codex" })).rejects.toThrow("lyrics_generation_degraded");

    expect(callAiProviderMock).toHaveBeenCalledTimes(3);
    const state = await readSongState(root, "song-001");
    expect(state.degradedLyrics).toBe(true);
    expect(state.status).toBe("brief");
  });
});
