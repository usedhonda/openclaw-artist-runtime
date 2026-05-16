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

    expect(text).toContain("次のボタン:");
    expect(text).toContain("- Suno 生成へ: prompt_pack の停止を解除し、次 cycle で Suno 生成へ進めます。");
    expect(text).toContain("- lyrics-suno.md を編集: planning に戻し、歌詞をもう一度作り直します。");
    expect(text).toContain("- 保留: この曲を user_paused にして後で再開できる状態にします。");
  });

  it("keeps non-action telemetry bodies free of button effects", async () => {
    const text = await formatRuntimeEvent({
      type: "autopilot_stage_changed",
      from: "planning",
      to: "prompt_pack",
      songId: "song-018",
      timestamp: 1
    });

    expect(text).not.toContain("次のボタン:");
  });
});
