import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

describe("telegram button effect section", () => {
  it("adds plain next-button effects to prompt_pack_ready body", async () => {
    const text = await formatRuntimeEvent({
      type: "prompt_pack_ready",
      songId: "song-018",
      title: "コピー機の夜景",
      lyricsExcerpt: "夜のコピー機が光る",
      mood: "cold",
      tempo: "92 BPM",
      styleNotes: "low bass, dry drums",
      timestamp: 1
    });

    expect(text).toContain("次:\nボタンで選ぶ");
    expect(text).toContain("ボタン不可: /suno go song-018 / /suno edit song-018 / /suno hold song-018");
    expect(text).not.toContain("次のボタン:");
    expect(text).not.toContain("prompt_pack の停止を解除");
  });

  it("keeps non-action telemetry bodies free of button effects", async () => {
    const text = await formatRuntimeEvent({
      type: "autopilot_stage_changed",
      from: "planning",
      to: "prompt_pack",
      songId: "song-018",
      timestamp: 1
    });

    expect(text).not.toContain("次:");
  });

  it("adds text fallback commands to daily voice decision cards", async () => {
    const text = await formatRuntimeEvent({
      type: "artist_pulse_drafted",
      voiceKind: "daily_voice",
      draftText: "今日の街は、少しだけ速い。",
      draftHash: "hash-daily-voice",
      charCount: 15,
      timestamp: 1
    });

    expect(text).toContain("次:\nボタンで選ぶ");
    expect(text).toContain("ボタン不可: /pulse publish / /pulse edit / /pulse cancel");
  });

  it("adds text fallback commands to distribution decision cards", async () => {
    const text = await formatRuntimeEvent({
      type: "distribution_change_detected",
      songId: "song-dist",
      platform: "spotify",
      url: "https://open.spotify.com/track/dist",
      proposalId: "dist-proposal",
      timestamp: 1
    });

    expect(text).toContain("次:\nボタンで選ぶ");
    expect(text).toContain("ボタン不可: /dist apply dist-proposal / /dist skip dist-proposal");
  });
});
