import { mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
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

    expect(message).toContain("🎵 「Civic Static」ができた。");
    expect(message).toContain("きっかけになったニュース");
    expect(message).toContain("ニュースの概要\nold live houses disappear under identical signs");
    expect(message).toContain("俺が思ったこと\nこの観察を曲の起点として残した。");
    expect(message).not.toContain("ARTIST.md");
    expect(message).not.toContain("SOUL.md");
    expect(message).not.toContain("selected:");
    expect(message).not.toContain("Xで拾った反応:");
    expect(message).toContain("1. https://suno.com/song/a\n2. https://suno.com/song/b");
  });

  it("explains the completed song from its bound lyrics and production pack instead of persona files", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-take-explanation-"));
    await ensureArtistWorkspace(root);
    const packDir = join(root, "songs", "song-explained", "prompts", "prompt-pack-v001");
    const sunoDir = join(root, "songs", "song-explained", "suno");
    await mkdir(packDir, { recursive: true });
    await mkdir(sunoDir, { recursive: true });
    const payload = { songName: "終電のショーケース" };
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await writeFile(join(packDir, "suno-payload.json"), JSON.stringify(payload), "utf8");
    await writeFile(join(packDir, "metadata.json"), JSON.stringify({ payloadHash }), "utf8");
    await writeFile(join(packDir, "style.md"), "94 BPM, dry jazz-rap, dusty Rhodes, upright bass, clipped drums, a cappella final bar", "utf8");
    await writeFile(join(packDir, "exclude.md"), "festival EDM, glossy pop", "utf8");
    await writeFile(join(packDir, "lyrics.md"), [
      "[Intro - station ambience]",
      "終電のガラスに 値札だけ光る",
      "[Verse 1 - close dry rap]",
      "閉店のテープが 昨日の入口を塞ぐ",
      "名前の消えた箱で 拍手だけが残る",
      "[Pre-Hook - bass drops out]",
      "便利の四文字で 記憶まで畳むな",
      "[Hook - restrained double]",
      "消える前に名前を呼べ",
      "同じ看板に塗るな",
      "[Verse 2 - Rhodes returns]",
      "再開発の模型に 夜は住めない",
      "[Bridge - near spoken]",
      "残響は立退き通知を読まない",
      "[Final Hook - full band then cut]",
      "消える前に名前を呼べ",
      "同じ看板に塗るな",
      "[Outro - a cappella]",
      "シャッターの向こうで まだ一拍"
    ].join("\n"), "utf8");
    await writeFile(join(sunoDir, "runs.jsonl"), `${JSON.stringify({
      runId: "run-explained",
      songId: "song-explained",
      createdAt: "2026-09-16T00:00:00.000Z",
      status: "accepted",
      payloadHash,
      urls: ["https://suno.com/song/explained"],
      dryRun: false
    })}\n`, "utf8");
    await updateSongState(root, "song-explained", {
      title: "終電のショーケース",
      status: "take_selected",
      selectedTakeId: "take-explained",
      observationSummary: {
        author: "City Desk",
        url: "https://example.com/venue-closure",
        quote: "再開発で老舗ライブハウスが閉館する",
        motivation: "ARTIST.md の都市観察と SOUL.md の静かな違和感に接続"
      }
    });

    const message = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-explained",
      selectedTakeId: "take-explained",
      urls: ["https://suno.com/song/explained"],
      timestamp: 1
    }, { workspaceRoot: root });

    expect(message).toContain("きっかけになったニュース\nCity Desk\nhttps://example.com/venue-closure");
    expect(message).toContain("ニュースの概要\n再開発で老舗ライブハウスが閉館する");
    expect(message).toContain("歌詞にどう入れたか");
    expect(message).toContain("「消える前に名前を呼べ」と「同じ看板に塗るな」へ変えて");
    expect(message).toContain("歌詞のテクニカルな要所");
    expect(message).toContain("・「終電のガラスに 値札だけ光る」");
    expect(message).toContain("・「残響は立退き通知を読まない」");
    expect(message).toContain("そして、曲へ\n94 BPM、乾いた質感、短く切ったドラム、少しくすんだローズピアノ、ウッドベース");
    expect(message).toContain("聴いてほしいところ");
    expect(message).not.toContain("dry jazz-rap");
    expect(message).not.toContain("Intro → Verse");
    expect(message).not.toContain("提出する");
    expect(message).not.toContain("ARTIST.md");
    expect(message).not.toContain("SOUL.md");
    expect(message).not.toContain("自分の都市観察");
  });

  it("recovers the song-bound source and explanation when the completion event omits it", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-take-state-source-"));
    await ensureArtistWorkspace(root);
    await updateSongState(root, "song-news", {
      title: "閉館後の残響",
      status: "take_selected",
      observationSummary: {
        author: "City Desk",
        url: "https://example.com/live-house",
        quote: "老舗ライブハウスが今月閉館する",
        motivation: "音が消える前の空気を、そのまま終わらせたくなかった。"
      }
    });

    const message = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-news",
      urls: ["https://suno.com/song/news"],
      timestamp: 1
    }, { workspaceRoot: root });

    expect(message).toContain("ニュースの概要\n老舗ライブハウスが今月閉館する");
    expect(message).toContain("俺が思ったこと");
    expect(message).toContain("そのまま終わらせたくなかった");
    expect(message).toContain("https://example.com/live-house");
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
