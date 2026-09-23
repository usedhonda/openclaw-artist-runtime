import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

describe("telegram readable sections", () => {
  it("keeps the spawn card sections in producer-room order", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_sections",
      brief: {
        songId: "spawn_sections",
        title: "順番の街",
        brief: "順番が分かる通知。",
        lyricsTheme: "順番が分かる通知。",
        mood: "quiet",
        tempo: "108 BPM",
        duration: "3:15",
        styleNotes: "dry drums",
        sourceText: "fixture",
        createdAt: "2026-06-25T00:00:00.000Z"
      },
      reason: "この順番なら読む側が迷わない。",
      timestamp: 1
    });

    const order = ["素案:", "今見てるもの:", "曲にする理由:", "作る曲:", "次:"];
    const indexes = order.map((label) => text.indexOf(label));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });
});
