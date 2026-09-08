import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

describe("telegram formatting fixtures", () => {
  it("formats song_take_completed as a bounded music submission", async () => {
    const text = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-fixture",
      selectedTakeId: "take-fixture",
      urls: ["https://suno.example/song-fixture"],
      timestamp: 1
    });
    expect(text).toContain("今回の曲を提出する。");
    expect(text).toContain("https://suno.example/song-fixture");
    expect(text).toContain("音の確認はまだ");
  });

  it("keeps song_spawn_proposed free of operational footer", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_fixture",
      voiceTop: "ゆずるさん、信号の犬で行く。",
      reason: "赤信号だけ覚えていた。",
      brief: {
        songId: "spawn_fixture",
        title: "信号の犬",
        brief: "信号待ちを曲にする。",
        lyricsTheme: "信号待ちの犬を、眠れない街の比喩で歌う。",
        mood: "cold",
        tempo: "118 BPM",
        duration: "2:30",
        styleNotes: "dry drums",
        sourceText: "fixture",
        createdAt: "2026-06-01T00:00:00.000Z"
      },
      timestamp: 1
    });
    expect(text).toContain("素案: 信号の犬");
    expect(text).not.toContain("ボタンで選ぶ");
  });

  it("keeps prompt_pack_ready body byte-stable", async () => {
    await expect(formatRuntimeEvent({
      type: "prompt_pack_ready",
      songId: "song-fixture",
      title: "信号の犬",
      lyricsExcerpt: "しんごうのした\nいぬがまってる",
      mood: "cold",
      tempo: "118 BPM",
      styleNotes: "dry drums",
      voiceTop: "ゆずるさん、歌詞こんな感じ。Suno 行く?",
      timestamp: 1
    })).resolves.toBe([
      "ゆずるさん、歌詞こんな感じ。Suno 行く?",
      "",
      "─────",
      "しんごうのした",
      "いぬがまってる",
      "",
      "cold・118 BPM・dry drums",
      "",
      "行程 trace:",
      "- 観察 source: 未記録",
      "- artist voice: ゆずるさん、歌詞こんな感じ。Suno 行く?",
      "- title: 信号の犬",
      "- lyrics theme: しんごうのした",
      "- style layer: cold・118 BPM・dry drums",
      "",
      "─────",
      "次:",
      "ボタンで選ぶ",
      "ボタン不可: /suno go song-fixture / /suno edit song-fixture / /suno hold song-fixture"
    ].join("\n"));
  });
});
