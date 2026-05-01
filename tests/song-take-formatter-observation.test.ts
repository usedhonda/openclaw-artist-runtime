import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { updateSongState } from "../src/services/artistState";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

describe("song take formatter observation source", () => {
  it("renders song_take_completed as five producer-readable blocks", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-take-observation-"));
    await ensureArtistWorkspace(root);
    await updateSongState(root, "song-observe", {
      title: "Civic Static",
      status: "take_selected",
      selectedTakeId: "take-2",
      observationSummary: {
        author: "citywatch",
        url: "https://x.com/citywatch/status/42",
        quote: "old live houses disappear under identical signs",
        motivation: "ARTIST.md の都市観察と SOUL.md の静かな違和感に接続"
      }
    });

    const message = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-observe",
      selectedTakeId: "take-2",
      urls: ["https://suno.com/song/a", "https://suno.com/song/b"],
      timestamp: 1
    }, { workspaceRoot: root });

    expect(message).toContain("🌐 観察元: @citywatch (https://x.com/citywatch/status/42)");
    expect(message).toContain("💬 抜粋: 「old live houses disappear under identical signs」");
    expect(message).toContain("🎯 動機: ARTIST.md の都市観察と SOUL.md の静かな違和感に接続");
    expect(message).toContain("🎵 タイトル: Civic Static (selected: take-2)");
    expect(message).toContain("🔗 試聴:\n1. https://suno.com/song/a\n2. https://suno.com/song/b");
  });
});
