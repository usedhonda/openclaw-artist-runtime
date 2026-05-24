import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";
import type { CommissionBrief } from "../src/types";

function brief(): CommissionBrief {
  return {
    songId: "spawn_9a57b4",
    title: "Backyard Cure",
    brief: "再開発の街の裏側を切る。",
    lyricsTheme: "街が治るふりをする夜",
    mood: "tense, cynical, urgent",
    tempo: "148 BPM",
    duration: "2:45",
    styleNotes: "distorted bass, dry drums",
    sourceText: "autopilot spawn",
    createdAt: "2026-04-30T00:00:00.000Z"
  };
}

describe("telegram spawn hybrid format", () => {
  it("places artist voice top above the metadata block", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      voiceTop: "ゆずる、再開発の街を切るやつ、刺さる",
      candidateSongId: "spawn_9a57b4",
      brief: brief(),
      reason: "街の剥がれ方が刺さった。低い熱で行く。",
      timestamp: 1
    });

    expect(text.split("\n").slice(0, 3)).toEqual([
      "ゆずるさん、今日は外の観察が薄い。",
      "俺の中に残っている今の違和感だけで、まず話す。",
      ""
    ]);
    expect(text).toMatch(/これを読んで、俺は/);
    expect(text).toContain("voice: ゆずる、再開発の街を切るやつ、刺さる");
    expect(text).toContain("行程 trace:");
    expect(text).toContain("街の剥がれ方が刺さった。低い熱で行く。");
  });

  it("keeps a fallback top when voiceTop is absent", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_9a57b4",
      brief: brief(),
      reason: "観察が強い。",
      timestamp: 1
    });

    expect(text).toContain("voice: ゆずるさん、次の曲の話をしたい。");
    expect(text).toContain("行程 trace:");
  });
});
