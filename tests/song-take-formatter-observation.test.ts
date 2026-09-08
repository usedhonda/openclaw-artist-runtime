import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { updateSongState } from "../src/services/artistState";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

describe("song take formatter observation source", () => {
  it("uses event-bound inspiration without operational metadata", async () => {
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
      observationSummary: {
        author: "citywatch",
        url: "https://x.com/citywatch/status/42",
        quote: "old live houses disappear under identical signs",
        motivation: "ARTIST.md の都市観察と SOUL.md の静かな違和感に接続"
      },
      timestamp: 1
    }, { workspaceRoot: root });

    expect(message).toContain("自分の都市観察と、いまの静かな違和感を、ここに繋いだ");
    expect(message).not.toContain("ARTIST.md");
    expect(message).not.toContain("SOUL.md");
    expect(message).not.toContain("selected:");
    expect(message).not.toContain("Xで拾った反応:");
    expect(message).toContain("1. https://suno.com/song/a\n2. https://suno.com/song/b");
  });

  it("does not attribute mutable latest brief observations to an unbound historical submission", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-take-brief-source-"));
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "songs", "song-brief-x"), { recursive: true });
    await writeFile(join(root, "songs", "song-brief-x", "brief.md"), [
      "# Brief for 追加時間の渋谷",
      "",
      "## Observation source",
      "- Author: X public reaction + manual news seed",
      "- URL: https://x.com/otsurikan_0/status/2071690874166341774",
      "- Quote: X reaction around Brazil 2-1 Japan: 惜しい、悔しい、ありがとう、田中碧を責めるな。"
    ].join("\n"), "utf8");
    await updateSongState(root, "song-brief-x", {
      title: "追加時間の渋谷",
      status: "take_selected",
      selectedTakeId: "take-x"
    });

    const message = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-brief-x",
      selectedTakeId: "take-x",
      urls: ["https://suno.com/song/a"],
      timestamp: 1
    }, { workspaceRoot: root });

    expect(message).not.toContain("Xで拾った反応:");
    expect(message).not.toContain("惜しい、悔しい、ありがとう、田中碧を責めるな");
    expect(message).not.toContain("記録なし");
    expect(message).toContain("https://suno.com/song/a");
  });
});
