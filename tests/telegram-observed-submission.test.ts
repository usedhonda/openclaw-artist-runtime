import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "telegram-observed-submission-"));
  const songId = "song-observed";
  const runId = "run-observed";
  await mkdir(join(root, "songs", songId, "suno"), { recursive: true });
  const pack = await createAndPersistSunoPromptPack({
    workspaceRoot: root, songId, songTitle: "Prepared title", artistReason: "prepared reason",
    lyricsText: "[Verse]\nprepared lyrics", styleAndFeel: "92 BPM, sparse", bpm: 92, preserveSongStatus: true
  });
  const urls = ["https://suno.com/song/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"];
  await writeFile(join(root, "songs", songId, "suno", "runs.jsonl"), JSON.stringify({
    runId, songId, status: "accepted", urls, payloadHash: pack.pack.payloadHash, createdAt: new Date().toISOString()
  }) + "\n");
  await mkdir(join(root, "songs", songId, "suno-evidence", runId), { recursive: true });
  return { root, songId, runId, urls };
}

describe("Telegram observed Suno submission grounding", () => {
  it("uses observed lyrics, style, and title while retaining the bound source reaction", async () => {
    const { root, songId, runId, urls } = await fixture();
    await writeFile(join(root, "songs", songId, "suno-evidence", runId, "submission-deadbeef.json"), JSON.stringify({
      version: 1, songId, runId, source: "observed_generate_response", urls,
      fields: { title: "Manual title", lyrics: "[Verse]\nmanual kana lyrics", style: "148 BPM, dry close" }
    }));
    const text = await formatRuntimeEvent({ type: "song_take_completed", songId, urls, timestamp: 1 }, { workspaceRoot: root });
    expect(text).toContain("「Manual title」");
    expect(text).toContain("manual kana lyrics");
    expect(text).toContain("148 BPM");
    expect(text).not.toContain("prepared lyrics");
  });

  it("labels prepared-only runs as pre-Create design when observation is missing", async () => {
    const { root, songId, runId, urls } = await fixture();
    await writeFile(join(root, "songs", songId, "suno-evidence", runId, "prepared.json"), JSON.stringify({
      version: 1, songId, runId, source: "verified_ui_readback", fields: {}
    }));
    const text = await formatRuntimeEvent({ type: "song_take_completed", songId, urls, timestamp: 1 }, { workspaceRoot: root });
    expect(text).toContain("Create前の設計");
    expect(text).toContain("実際にSunoへ送った内容との差分は未確認");
  });

  it("does not present an unobserved style as the submitted style", async () => {
    const { root, songId, runId, urls } = await fixture();
    await writeFile(join(root, "songs", songId, "suno-evidence", runId, "submission-deadbeef.json"), JSON.stringify({
      version: 1, songId, runId, source: "observed_generate_response", urls,
      fields: { lyrics: "[Verse]\\nmanual lyrics only" }
    }));
    const text = await formatRuntimeEvent({ type: "song_take_completed", songId, urls, timestamp: 1 }, { workspaceRoot: root });
    expect(text).toContain("manual lyrics only");
    expect(text).not.toContain("92 BPMで");
    expect(text).toContain("Sunoへ送ったスタイルは未観測");
  });

  it("preserves original kanji note highlights when the submitted payload is kana", async () => {
    const root = await mkdtemp(join(tmpdir(), "telegram-observed-kana-"));
    const songId = "song-kana";
    const runId = "run-kana";
    await mkdir(join(root, "songs", songId, "suno"), { recursive: true });
    const pack = await createAndPersistSunoPromptPack({
      workspaceRoot: root, songId, songTitle: "Kana title", artistReason: "original reaction",
      lyricsText: "[Verse]\nかんじのよる\n[Hook]\nもどれない", styleAndFeel: "92 BPM, sparse", bpm: 92, preserveSongStatus: true
    });
    const packDir = `prompt-pack-v${String(pack.packVersion).padStart(3, "0")}`;
    await writeFile(join(root, "songs", songId, "prompts", packDir, "lyrics.md"), "[Verse]\n漢字の夜\n[Hook]\n戻れない\n");
    await writeFile(join(root, "songs", songId, "prompts", packDir, "creative-note.json"), JSON.stringify({
      version: 1, source: {}, artistReaction: "original reaction", lyricHighlights: [
        { quote: "漢字の夜", explanation: "original highlight" },
        { quote: "戻れない", explanation: "original turn" }
      ], listenFor: ["original listening cue"]
    }));
    const payloadPath = join(root, "songs", songId, "prompts", packDir, "suno-payload.json");
    const payload = JSON.parse(await readFile(payloadPath, "utf8")) as Record<string, unknown>;
    payload.lyrics = "[Verse]\nかんじのよる\n[Hook]\nもどれない";
    await writeFile(payloadPath, JSON.stringify(payload) + "\n");
    const urls = ["https://suno.com/song/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"];
    await writeFile(join(root, "songs", songId, "suno", "runs.jsonl"), JSON.stringify({ runId, songId, status: "accepted", urls, payloadHash: pack.pack.payloadHash }) + "\n");
    await mkdir(join(root, "songs", songId, "production-runs"), { recursive: true });
    await writeFile(join(root, "songs", songId, "production-runs", `${runId}.json`), JSON.stringify({ songId, runId, packVersion: pack.packVersion, payloadHash: pack.pack.payloadHash, baselineStatus: "idea", createdAt: new Date().toISOString() }));
    const text = await formatRuntimeEvent({ type: "song_take_completed", songId, urls, timestamp: 1 }, { workspaceRoot: root });
    expect(text).toContain("「漢字の夜」");
    expect(text).toContain("「戻れない」");
    expect(text).not.toContain("「かんじのよる」");
  });
});
