import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { updateSongState } from "../src/services/artistState";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-telegram-result-card-"));
  await ensureArtistWorkspace(root);
  await mkdir(join(root, "songs", "song-result"), { recursive: true });
  await writeFile(join(root, "songs", "song-result", "brief.md"), [
    "# Brief for Civic Bounce",
    "",
    "## Direction",
    "- Lyrics theme: ニュースの安全神話とXの皮肉を、短いフックへ畳む。",
    "- Mood: tense, sarcastic",
    "- Tempo: 148 BPM",
    "- Style notes: fast social rap, clipped hook, distorted 808",
    "",
    "## Frozen sources",
    "- news: https://example.com/news/luup (example.com) — LUUP事故で街の安全感覚が揺れている",
    "- x_reaction: https://x.com/citywatch/status/123 (citywatch) — 便利って言葉で危なさまで薄めるの、もう限界"
  ].join("\n"), "utf8");
  await updateSongState(root, "song-result", {
    title: "Civic Bounce",
    status: "suno_take_url_ready",
    selectedTakeId: "take-ready",
    appendPublicLinks: ["https://suno.com/song/take-ready"],
    observationSummary: {
      author: "example.com",
      url: "https://example.com/news/luup",
      quote: "LUUP事故で街の安全感覚が揺れている",
      motivation: "ニュースとX反応を曲に変換"
    }
  });
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId: "song-result",
    songTitle: "Civic Bounce",
    artistReason: "news plus X reaction should drive the song",
    lyricsText: "[Verse 1]\nべんりのかげでブレーキがきえる\n[Hook]\nうすいあんぜん うすいあんぜん",
    moodHint: "fast civic rap",
    bpm: 148
  });
  return root;
}

describe("Telegram result card", () => {
  it("reports Suno URL, news source, X reaction, conversion, and lyric density together", async () => {
    const root = await workspace();
    const text = await formatRuntimeEvent({
      type: "suno_take_url_ready",
      songId: "song-result",
      runId: "run-ready",
      selectedTakeId: "take-ready",
      urls: ["https://suno.com/song/take-ready"],
      timestamp: 1
    }, { workspaceRoot: root });

    expect(text).toContain("https://suno.com/song/take-ready");
    expect(text).toContain("今回の起点:");
    expect(text).toContain("元ニュース: News / example.com");
    expect(text).toContain("Xで拾った反応:");
    expect(text).toContain("反応: X reaction / citywatch");
    expect(text).toContain("曲への変換:");
    expect(text).toContain("歌詞チェック:");
    expect(text).toContain("採用して音源取得");
  });
});
