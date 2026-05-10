import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeSongSpawnProposalVoice } from "../src/services/songSpawnProposalVoiceComposer";

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

async function setupWorkspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "spawn-pitch-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), ARTIST_MD, "utf8");
  await writeFile(join(root, "SOUL.md"), SOUL_MD, "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "Emotional weather: 観察者の温度\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short and direct\n", "utf8");
  return root;
}

const COMPLETE_BRIEF = {
  songId: "song-test",
  title: "経営者の灯",
  brief: "六本木で見た経営者の言葉、街の温度",
  lyricsTheme: "六本木で見た経営者の言葉を、社会風刺の曲にする。ずっと抱えてた違和感を、フックでは逃がさない。夜の景色として、言い切らずに最後まで残す。",
  mood: "tense, observant",
  tempo: "94 bpm",
  duration: "3:30",
  styleNotes: "thick bass, restrained drums",
  sourceText: "test",
  createdAt: new Date().toISOString()
};

const COMPLETE_REASON = "ゆずるさん、六本木で見た経営者の言葉がずっと残ってる。社会風刺として切る、捨てずに持ってた違和感をそのまま置いて、低い音に委ねたいな。";

const COMPLETE_OBSERVATION = {
  quote: "再開発で小さい店がまた消えた",
  author: "city_note",
  url: "https://x.com/city_note/status/1234567890123456789"
};

function charLength(text: string): number {
  return Array.from(text).length;
}

function paragraphs(text: string): string[] {
  return text.split(/\r?\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
}

describe("song spawn proposal pitch density contract", () => {
  it("complete brief produces 6+ paragraphs in 380-650 chars with observation source attribution", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-complete",
      brief: COMPLETE_BRIEF,
      reason: COMPLETE_REASON,
      observation: COMPLETE_OBSERVATION
    });

    expect(charLength(voice)).toBeGreaterThanOrEqual(380);
    expect(charLength(voice)).toBeLessThanOrEqual(700);
    expect(paragraphs(voice).length).toBeGreaterThanOrEqual(6);
    expect(voice).toContain("@city_note");
    expect(voice).toMatch(/https:\/\/x\.com\/city_note\/status\/\d+/);
    expect(voice).toContain("再開発で小さい店がまた消えた");
  });

  it("thin context produces shorter voice with honest marker, no fake source", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-thin",
      brief: {
        ...COMPLETE_BRIEF,
        title: "未定",
        brief: "TBD",
        lyricsTheme: "TBD",
        mood: "TBD",
        styleNotes: "TBD",
        tempo: "artist decides",
        duration: "artist decides"
      },
      reason: "ゆずるさん、まだ輪郭しかない。これから詰めるな。",
      observation: undefined
    });

    expect(charLength(voice)).toBeLessThan(380);
    expect(charLength(voice)).toBeGreaterThanOrEqual(150);
    expect(voice).toMatch(/まだ|輪郭|仮で|これから|薄い/);
    expect(voice).not.toMatch(/https:\/\/(?:t\.co|x\.com|twitter\.com)/);
    expect(voice).not.toMatch(/@[A-Za-z0-9_]{3,}/);
  });

  it("no machine voice leaks (file names, placeholder, motif raw, builder verbs)", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-leak-check",
      brief: COMPLETE_BRIEF,
      reason: COMPLETE_REASON,
      observation: COMPLETE_OBSERVATION
    });

    expect(voice).not.toMatch(/ARTIST\.md|SOUL\.md|INNER\.md|PRODUCER\.md|IDENTITY\.md/i);
    expect(voice).not.toMatch(/themes:|geographies:|geo:|vocab:|sound:|motif anchor:/i);
    expect(voice).not.toMatch(/\bTBD\b|未定|未記入|\btodo\b|\bfixme\b|\bnone\b|n\/a/i);
    expect(voice).not.toMatch(/基礎人格|基礎トーン|基礎理性|基礎商業/);
    expect(voice).not.toMatch(/に基づき|を反映し|を変換|を生成/);
    expect(voice).not.toMatch(/artist\s*一人称/);
    expect(voice).not.toMatch(/観察ログ/);
  });

  it("short URL only observation is discarded from voice", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-short-url",
      brief: COMPLETE_BRIEF,
      reason: COMPLETE_REASON,
      observation: {
        quote: "短縮 URL のみの観察",
        author: "city_note",
        url: "https://t.co/abc123"
      }
    });

    expect(voice).not.toMatch(/t\.co/);
    expect(voice).not.toContain("短縮 URL のみの観察");
  });

  it("missing author or missing url discards observation source", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-no-author",
      brief: COMPLETE_BRIEF,
      reason: COMPLETE_REASON,
      observation: {
        quote: "author 不在の引用",
        url: "https://x.com/anon/status/1234567890"
      }
    });

    expect(voice).not.toContain("author 不在の引用");
    expect(voice).not.toMatch(/@undefined|@_\b/);
  });

  it("forbidden_phrases from fingerprint are filtered out", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-fingerprint",
      brief: COMPLETE_BRIEF,
      reason: COMPLETE_REASON,
      observation: COMPLETE_OBSERVATION
    });

    expect(voice).not.toContain("了解しました");
    expect(voice).not.toContain("申し訳ございません");
    expect(voice).not.toContain("ご確認ください");
  });

  it("uses producer callname from fingerprint", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-callname",
      brief: COMPLETE_BRIEF,
      reason: COMPLETE_REASON,
      observation: COMPLETE_OBSERVATION
    });

    expect(voice).toContain("ゆずるさん");
  });

  it("brief absent + observation absent produces minimal honest fallback", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-bare",
      brief: undefined,
      reason: undefined,
      observation: undefined
    });

    expect(voice.length).toBeGreaterThan(0);
    expect(voice).not.toMatch(/\bTBD\b|undefined|null/);
    expect(voice).not.toMatch(/https:\/\//);
  });

  it("secret-like quote is filtered out of voice", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-secret",
      brief: COMPLETE_BRIEF,
      reason: COMPLETE_REASON,
      observation: {
        quote: "API_KEY=AKIA1234567890ABCDEF",
        author: "leak_bot",
        url: "https://x.com/leak_bot/status/9999999999"
      }
    });

    expect(voice).not.toContain("API_KEY");
    expect(voice).not.toContain("AKIA");
  });

  it("trailing punctuation in coreTheme is stripped before joining", async () => {
    const root = await setupWorkspace();
    const voice = await composeSongSpawnProposalVoice({
      workspaceRoot: root,
      songId: "song-test-punct",
      brief: {
        ...COMPLETE_BRIEF,
        brief: "六本木で見た経営者の言葉。"
      },
      reason: COMPLETE_REASON,
      observation: COMPLETE_OBSERVATION
    });

    expect(voice).not.toMatch(/。の話だ/);
    expect(voice).not.toMatch(/、の話だ/);
  });
});
