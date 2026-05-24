import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

async function workspaceWithBrief(songId: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-cascade-trace-"));
  await ensureArtistWorkspace(root);
  await mkdir(join(root, "songs", songId), { recursive: true });
  await writeFile(join(root, "songs", songId, "brief.md"), [
    "# Brief for コピー機の夜景",
    "",
    "## Direction",
    "- Lyrics theme: コピー機の白い光を、夜の会社の孤独として切る。サビは短く畳む。",
    "- Mood: cold, office pressure",
    "- Tempo: 104 BPM",
    "- Style notes: low bass, dry drums, empty-room vocal",
    "",
    "## Observation source",
    "- Author: @office_watcher",
    "- Quote: 深夜のコピー機だけがまだ働いている",
    "- URL: https://x.com/office_watcher/status/12345"
  ].join("\n"), "utf8");
  return root;
}

describe("cascade trace section", () => {
  it("adds five cascade layers to prompt_pack_ready", async () => {
    const root = await workspaceWithBrief("song-cascade");
    const text = await formatRuntimeEvent({
      type: "prompt_pack_ready",
      songId: "song-cascade",
      title: "コピー機の夜景",
      lyricsExcerpt: "深夜のコピー機\n白い光だけ",
      mood: "cold",
      tempo: "104 BPM",
      styleNotes: "low bass",
      voiceTop: "ゆずるさん、歌詞ここまで来た。",
      timestamp: 1
    }, { workspaceRoot: root });

    expect(text).toContain("行程 trace:");
    expect(text).toContain("- 観察 source:");
    expect(text).toContain("- artist voice:");
    expect(text).toContain("- title: コピー機の夜景");
    expect(text).toContain("- lyrics theme: コピー機の白い光");
    expect(text).toContain("- style layer: low bass");
  });

  it("adds the same five layers to song_take_completed", async () => {
    const root = await workspaceWithBrief("song-cascade");
    const text = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-cascade",
      selectedTakeId: "take-1",
      urls: ["https://suno.com/song/take-1"],
      timestamp: 1
    }, { workspaceRoot: root, aiReviewProvider: "mock" });

    expect(text).toContain("行程 trace:");
    expect(text).toContain("- 観察 source:");
    expect(text).toContain("- artist voice:");
    expect(text).toContain("- title: song-cascade");
    expect(text).toContain("- lyrics theme: コピー機の白い光");
    expect(text).toContain("- style layer: low bass");
  });
});
