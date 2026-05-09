import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composePlanningSkeletonVoice } from "../src/services/planningSkeletonVoiceComposer";

const ARTIST_MD = `Artist name: used::honda

## Current Artist Core
- 社会風刺
- 権力構造
- 経営者と地べた

## Lyrics
- 短い言葉
- 経営者
- 地べた
- 俗語
`;

const SOUL_MD = `# SOUL

## Vibe / Production Voice (the music DNA)

中音域、観察者の温度。

### sentence_endings (許可する語尾の rotation list)

- "。"
- "だ。"
- "だろ。"
- "じゃない?"
- "な。"
- "わ。"
- "けど。"

### forbidden_phrases (絶対に出さない言い回し、御大が refine 前提)

- "了解しました"
- "申し訳ございません"
- "ご確認ください"

### producer_callname

- producer_callname: ゆずるさん
- first_person: 俺
`;

const BRIEF_MD = `# Brief for Song 011

## Why this song exists

A public-facing song grown from 社会風刺を六本木の視点から切る.

## Direction

- Core theme: 社会風刺を六本木の視点から切る
- Artist reason: motifs(社会風刺・六本木) と観察ログを照合し、アーティスト視座で自然に成立する切り口を選んだ
- Mood: cold, observant, quietly obsessive
- Keep the images concrete and the chorus short

## Observation source

- Path: observations/2026-05-08.md
- Author: anonymous
- URL:
- Quote: Any vote is important now! Vote for SJ!
- Motivation: derived from current observations
`;

async function setupWorkspace(briefMd: string = BRIEF_MD): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-planning-voice-depth-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "songs", "song-011"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), ARTIST_MD, "utf8");
  await writeFile(join(root, "SOUL.md"), SOUL_MD, "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "Emotional weather: 観察者の温度\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short and direct\n", "utf8");
  await writeFile(join(root, "songs", "song-011", "brief.md"), briefMd, "utf8");
  return root;
}

function sentenceCount(text: string): number {
  return text.split(/[。?]/).map((s) => s.trim()).filter((s) => s.length > 0).length;
}

const SENTENCE_ENDINGS = ["。", "だ。", "だろ。", "じゃない?", "な。", "わ。", "けど。"];
const SENTINEL_PATTERNS = [
  /is not configured/i,
  /Planning skeleton incomplete:/,
  /missing:/,
  /\bYes\b/,
  /\bNo\b/,
  /\bEdit\b/,
  /\bOK\b/,
  /\bCancel\b/
];

describe("planning skeleton voice depth contract", () => {
  it("produces a 4+ sentence monolog with motif, observation, and persona ending", async () => {
    const root = await setupWorkspace();
    const text = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-011",
      missing: ["tempo", "duration", "style notes"]
    });

    expect(sentenceCount(text)).toBeGreaterThanOrEqual(4);

    const containsMotif =
      text.includes("社会風刺") ||
      text.includes("権力構造") ||
      text.includes("六本木") ||
      text.includes("経営者");
    expect(containsMotif).toBe(true);

    const containsEnding = SENTENCE_ENDINGS.some((ending) => text.includes(ending));
    expect(containsEnding).toBe(true);

    const containsObservationOrGeo = text.includes("Vote for SJ") || text.includes("六本木");
    expect(containsObservationOrGeo).toBe(true);

    for (const pattern of SENTINEL_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
  });

  it("closing sentence is producer-facing invitation (committed/任せ/委ね) but does not paste missing field labels", async () => {
    const root = await setupWorkspace();
    const text = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-011",
      missing: ["tempo", "duration", "style notes"]
    });

    expect(text).toMatch(/(進めていい|通すか|行ってよし|合ってる気がする|委ね|hash out)/);
    expect(text).not.toMatch(/テンポ.*長さ.*style/);
  });

  it("produces three different monologs for three different (songId, missing) combos", async () => {
    const root = await setupWorkspace();
    const a = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-011",
      missing: ["tempo", "duration", "style notes"]
    });

    await mkdir(join(root, "songs", "song-012"), { recursive: true });
    await writeFile(join(root, "songs", "song-012", "brief.md"), BRIEF_MD, "utf8");
    const b = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-012",
      missing: ["tempo", "duration"]
    });

    await mkdir(join(root, "songs", "song-013"), { recursive: true });
    await writeFile(join(root, "songs", "song-013", "brief.md"), BRIEF_MD, "utf8");
    const c = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-013",
      missing: ["mood"]
    });

    const set = new Set([a, b, c]);
    expect(set.size).toBe(3);
  });

  it("falls back to safe minimal monolog when brief.md is missing", async () => {
    const root = await setupWorkspace("");
    const text = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-011",
      missing: ["tempo"]
    });

    expect(text.length).toBeGreaterThan(0);
    for (const pattern of SENTINEL_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
  });

  it("filters secret-like observation quotes out of the voice", async () => {
    const briefWithSecret = BRIEF_MD.replace(
      "Any vote is important now! Vote for SJ!",
      "API_KEY=AKIA1234567890ABCDEF"
    );
    const root = await setupWorkspace(briefWithSecret);
    const text = await composePlanningSkeletonVoice({
      workspaceRoot: root,
      songId: "song-011",
      missing: ["tempo"]
    });

    expect(text).not.toContain("API_KEY");
    expect(text).not.toContain("AKIA");
  });
});
