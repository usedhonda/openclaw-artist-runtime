import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

describe("telegram take completed push", () => {
  it("formats private Suno URLs directly for the producer", async () => {
    const message = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-001",
      selectedTakeId: "take-1",
      urls: ["https://suno.example/take-1"],
      timestamp: 1
    });

    expect(message).toContain("提出する。");
    expect(message).toContain("今回の音源:");
    expect(message).not.toContain("記録なし");
    expect(message).not.toContain("song-001");
    expect(message).not.toContain("selected:");
    expect(message).toContain("1. https://suno.example/take-1");
    expect(message).not.toContain("採用/破棄");
  });
});
