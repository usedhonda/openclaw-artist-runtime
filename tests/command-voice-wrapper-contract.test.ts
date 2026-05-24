import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeVoiceTopOnly, isUnsafeCommandVoiceTopForTest, wrapCommandVoice } from "../src/services/commandVoiceWrapper";
import { ensureSongState } from "../src/services/artistState";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-command-voice-"));
}

async function writeVoice(root: string): Promise<void> {
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(
    join(root, "ARTIST.md"),
    "# ARTIST.md\n\n## Current artist core\n\n- Core obsessions: 社会風刺\n\n## Places\n\n渋谷\n",
    "utf8"
  );
  await writeFile(
    join(root, "SOUL.md"),
    [
      "# SOUL.md",
      "",
      "_俺は報告書じゃない。_",
      "",
      "## The Vibe",
      "低い熱で近く話す。",
      "",
      "### Signature Moves",
      "- 見たものを音に戻す",
      "",
      "## 文体 variation rule",
      "",
      "### forbidden_phrases",
      "- Available commands:",
      "- Autopilot:",
      "",
      "### sentence_endings",
      "- だね。",
      "- と思う。",
      "",
      "### reaction_phrases",
      "- うん",
      "",
      "## Producer (relationship in music-making)",
      "ゆずるさんに先に見せる。",
      "",
      "### Producer call",
      "- producer_callname: ゆずるさん",
      "- first_person: 俺"
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "# CURRENT_STATE.md\n\n- Emotional weather: 低い熱\n", "utf8");
}

function topOf(text: string): string {
  return text.split("─────")[0].trim();
}

describe("command voice wrapper", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("wraps deterministic info below an artist voice top", async () => {
    const root = makeRoot();
    await writeVoice(root);

    const text = await wrapCommandVoice({
      kind: "status",
      workspaceRoot: root,
      info: "Autopilot: enabled (dry-run)\nStage: planning\nSong: song-001",
      userMessage: "/status"
    });

    expect(text).toContain("─────\ninfo\nAutopilot: enabled");
    expect(topOf(text)).not.toContain("Autopilot:");
    expect(topOf(text)).not.toContain("song-001");
    expect(isUnsafeCommandVoiceTopForTest(topOf(text))).toBe(false);
  });

  it("allows song ids in voice tops but still rejects hashes", async () => {
    const root = makeRoot();
    await writeVoice(root);
    await writeFile(
      join(root, "SOUL.md"),
      [
        "# SOUL.md",
        "",
        "## The Vibe",
        "",
        "### Signature Moves",
        "- song-1234 を口に出してしまう",
        "- deadbeefcafebabe を口に出してしまう",
        "",
        "## 文体 variation rule",
        "",
        "### sentence_endings",
        "- 。",
        "",
        "## Producer (relationship in music-making)",
        "",
        "### Producer call",
        "- producer_callname: ゆずるさん",
        "- first_person: 俺"
      ].join("\n"),
      "utf8"
    );

    const songText = await wrapCommandVoice({
      kind: "song",
      workspaceRoot: root,
      info: "song-1234 | take_selected | Test",
      userMessage: "次の案ある?"
    });

    expect(topOf(songText)).toContain("song-1234");
    expect(isUnsafeCommandVoiceTopForTest(topOf(songText))).toBe(false);
    expect(songText).toContain("song-1234 | take_selected | Test");

    expect(isUnsafeCommandVoiceTopForTest("song-010 を取り込んだ。")).toBe(false);
    expect(isUnsafeCommandVoiceTopForTest("deadbeefcafebabe を見た。")).toBe(true);

    const hashRoot = makeRoot();
    await writeVoice(hashRoot);
    await writeFile(
      join(hashRoot, "SOUL.md"),
      [
        "# SOUL.md",
        "",
        "## The Vibe",
        "",
        "### Signature Moves",
        "- deadbeefcafebabe を口に出してしまう",
        "",
        "## 文体 variation rule",
        "",
        "### sentence_endings",
        "- 。",
        "",
        "## Producer (relationship in music-making)",
        "",
        "### Producer call",
        "- producer_callname: ゆずるさん",
        "- first_person: 俺"
      ].join("\n"),
      "utf8"
    );
    const hashText = await wrapCommandVoice({
      kind: "song",
      workspaceRoot: hashRoot,
      info: "deadbeefcafebabe | take_selected | Test",
      userMessage: "hash を見せて"
    });

    expect(topOf(hashText)).toBe("その曲の中身、下に出す。");
    expect(hashText).toContain("deadbeefcafebabe | take_selected | Test");
  });

  it("can compose a propose top without the info block", async () => {
    const root = makeRoot();
    await writeVoice(root);

    const top = await composeVoiceTopOnly("propose", root, "次の曲どうする?");

    expect(top).not.toContain("─────");
    expect(top).not.toContain("info");
    expect(isUnsafeCommandVoiceTopForTest(top)).toBe(false);
  });

  it("feeds recent observations into propose voice tops", async () => {
    const root = makeRoot();
    await writeVoice(root);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    await mkdir(join(root, "observations"), { recursive: true });
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await writeFile(join(root, "observations", `news-${today}.md`), [
      `# News Observations ${today}`,
      "",
      "- text: \"コピー機の夜が若者の疲れを照らしている\"",
      "  source: \"fixture news\"",
      "  motifMatch: \"若者\"",
      "  motifScore: 9"
    ].join("\n"), "utf8");

    const top = await composeVoiceTopOnly("propose", root, "propose");

    expect(top).toMatch(/コピー機|若者|fixture news/);
    expect(top).not.toBe("ゆずるさん、六本木の社会風刺を切るやつ、どう?");
    expect(isUnsafeCommandVoiceTopForTest(top)).toBe(false);
  });

  it("routes high-frequency commands as voice plus info", async () => {
    const root = makeRoot();
    await writeVoice(root);
    await ensureSongState(root, "song-001", "Ash Road");

    const help = await routeTelegramCommand({ text: "/help", fromUserId: 1, chatId: 1, workspaceRoot: root });
    const songs = await routeTelegramCommand({ text: "/songs", fromUserId: 1, chatId: 1, workspaceRoot: root });

    expect(help.responseText).toContain("─────\ninfo\nAvailable commands:");
    expect(songs.responseText).toContain("─────\ninfo\nsong-001");
    expect(topOf(help.responseText)).not.toContain("/status");
    expect(topOf(songs.responseText)).not.toContain("song-001");
  });
});
