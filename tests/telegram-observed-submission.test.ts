import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
});
