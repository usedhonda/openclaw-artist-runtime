import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

describe("telegram formatting fixtures", () => {
  it("keeps song_take_completed body byte-stable", async () => {
    await expect(formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-fixture",
      selectedTakeId: "take-fixture",
      urls: ["https://suno.example/song-fixture"],
      timestamp: 1
    })).resolves.toBe([
      "できた。song-fixture。聴いて、感想ほしい。",
      "",
      "─────",
      "🎵 song-fixture (selected: take-fixture)",
      "完成しました。採用/破棄は後からで結構です。",
      "🔗 試聴:",
      "1. https://suno.example/song-fixture",
      "🎯 動機: 観察 summary なし",
      "🌐 観察元: (記録なし)",
      "💬 抜粋: (記録なし)",
      "非公開、御大のみ",
      "",
      "─────",
      "次のボタン:",
      "- 採用: この曲を採用する。SNS には出さない。",
      "- 破棄: この曲を破棄する。brief は reuse のため残す。"
    ].join("\n"));
  });

  it("keeps song_spawn_proposed body byte-stable", async () => {
    await expect(formatRuntimeEvent({
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
    })).resolves.toBe([
      "素案を思いついた。草稿箱に入れた。",
      "",
      "ゆずるさん、今日は外の観察が薄い。",
      "俺の中に残っている今の違和感だけで、まず話す。",
      "",
      "これを読んで、俺は無視できなかっただ。",
      "『信号の犬』では、信号待ちの犬を、眠れない街の比喩で歌う。dry drums",
      "理由は、赤信号だけ覚えていた。",
      "",
      "voice: ゆずるさん、信号の犬で行く。",
      "title: 信号の犬",
      "lyrics: 信号待ちの犬を、眠れない街の比喩で歌う。",
      "style: dry drums",
      "",
      "─────",
      "行程 trace:",
      "- 観察 source: 未記録",
      "- artist voice: ゆずるさん、信号の犬で行く。",
      "- title: 信号の犬",
      "- lyrics theme: 信号待ちの犬を、眠れない街の比喩で歌う。",
      "- style layer: dry drums",
      "",
      "─────",
      "次のボタン:",
      "- 作る: この草稿で曲を完成まで作る。外部公開はしない。",
      "- 保留する: この着想を保留する。",
      "- 修正する: この commission を編集する。"
    ].join("\n"));
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
      "次のボタン:",
      "- Suno 生成へ: prompt_pack の停止を解除し、次 cycle で Suno 生成へ進めます。",
      "- lyrics-suno.md を編集: planning に戻し、歌詞をもう一度作り直します。",
      "- 保留: この曲を user_paused にして後で再開できる状態にします。"
    ].join("\n"));
  });
});
