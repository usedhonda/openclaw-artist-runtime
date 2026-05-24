import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSongDetailResponse } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import { buildSongCascadeTrace } from "../ui/src/components/SongDetailCard";

async function workspaceWithSong(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-cascade-api-"));
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "song-api", "コピー機の夜景");
  await updateSongState(root, "song-api", {
    reason: "ゆずるさん、コピー機の夜を切る。",
    observationSummary: {
      author: "office_watcher",
      quote: "深夜のコピー機だけがまだ働いている",
      url: "https://x.com/office_watcher/status/12345"
    }
  });
  await mkdir(join(root, "songs", "song-api"), { recursive: true });
  await writeFile(join(root, "songs", "song-api", "brief.md"), [
    "# Brief for コピー機の夜景",
    "",
    "- Lyrics theme: コピー機の白い光を、夜の会社の孤独として切る。",
    "- Style notes: low bass, dry drums",
    "- Author: @office_watcher",
    "- Quote: 深夜のコピー機だけがまだ働いている",
    "- URL: https://x.com/office_watcher/status/12345"
  ].join("\n"), "utf8");
  return root;
}

describe("cascade trace API field", () => {
  it("exposes a structured cascadeTrace field and keeps Telegram/UI rendering consistent", async () => {
    const root = await workspaceWithSong();
    const detail = await buildSongDetailResponse("song-api", { artist: { workspaceRoot: root } });
    const telegram = await formatRuntimeEvent({
      type: "prompt_pack_ready",
      songId: "song-api",
      title: "コピー機の夜景",
      lyricsExcerpt: "白い光だけ",
      mood: "cold",
      tempo: "104 BPM",
      styleNotes: "low bass",
      voiceTop: "ゆずるさん、コピー機の夜を切る。",
      timestamp: 1
    }, { workspaceRoot: root });
    const uiTrace = buildSongCascadeTrace(detail, "song-api");

    expect(detail.cascadeTrace?.observationSources[0]?.url).toBe("https://x.com/office_watcher/status/12345");
    expect(detail.cascadeTrace?.artistVoice).toContain("コピー機の夜");
    expect(detail.cascadeTrace?.lyricsTheme).toContain("コピー機の白い光");
    expect(detail.cascadeTrace?.styleLayer).toContain("low bass");
    expect(uiTrace?.title).toBe(detail.cascadeTrace?.title);
    expect(uiTrace?.styleLayer).toBe(detail.cascadeTrace?.styleLayer);
    expect(telegram).toContain("- lyrics theme: コピー機の白い光");
    expect(telegram).toContain("- style layer: low bass");
  });
});
