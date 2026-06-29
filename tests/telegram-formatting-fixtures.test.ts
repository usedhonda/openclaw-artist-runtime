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
      "🎵 song-fixture (selected: take-fixture)",
      "🔗 試聴:",
      "1. https://suno.example/song-fixture",
      "",
      "今回の起点:",
      "元ネタ: 記録なし",
      "",
      "Xで拾った反応:",
      "反応: 記録なし",
      "",
      "曲への変換:",
      "1. ニュース/観察: 未記録",
      "2. X反応: 記録なし",
      "3. 音: 未記録",
      "4. 揺らぎ: ドパガキ/高速展開/英日比率は prompt pack と artist 設定に従う",
      "",
      "歌詞チェック: 記録なし",
      "",
      "🎯 動機: 観察 summary なし",
      "🌐 観察元: (記録なし)",
      "💬 抜粋: (記録なし)",
      "完成しました。採用/破棄は後からで結構です。",
      "非公開、御大のみ",
      "",
      "─────",
      "次:",
      "ボタンで選ぶ",
      "ボタン不可: /song adopt song-fixture / /song discard song-fixture"
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
      "素案: 信号の犬",
      "",
      "今見てるもの:",
      "信号待ちを曲にする。",
      "",
      "曲にする理由:",
      "赤信号だけ覚えていた。",
      "",
      "作る曲:",
      "テンポは中速 / 冷たく静かな3分弱 / dry drums",
      "",
      "─────",
      "次:",
      "ボタンで選ぶ",
      "ボタン不可: /draft make spawn_fixture / /draft skip spawn_fixture / /draft edit spawn_fixture"
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
      "次:",
      "ボタンで選ぶ",
      "ボタン不可: /suno go song-fixture / /suno edit song-fixture / /suno hold song-fixture"
    ].join("\n"));
  });
});
