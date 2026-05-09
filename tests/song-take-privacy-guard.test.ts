import { describe, expect, it } from "vitest";
import { formatRuntimeEvent } from "../src/services/telegramNotifier";

describe("song take observation privacy guard", () => {
  it("hides non-X observation URLs", async () => {
    const message = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-guard",
      urls: [],
      observationSummary: {
        author: "source",
        url: "https://example.com/private/story",
        quote: "public quote",
        motivation: "safe reason"
      },
      timestamp: 1
    });

    expect(message).toContain("🌐 観察元: @source");
    expect(message).not.toContain("example.com");
  });

  it("caps long quotes and redacts handles outside the author block", async () => {
    const longQuote = `@other ${"長い本文".repeat(60)}`;
    const message = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-guard",
      urls: [],
      observationSummary: {
        author: "@main_author",
        url: "https://twitter.com/main_author/status/99",
        quote: longQuote,
        motivation: "@other の発言をそのまま広げず、観察の角度だけを曲に変換"
      },
      timestamp: 1
    });

    const quoteLine = message.split("\n").find((line) => line.startsWith("💬 抜粋:")) ?? "";
    expect(message).toContain("🌐 観察元: @main_author");
    expect(quoteLine).toContain("[handle]");
    expect(quoteLine).toContain("…");
    expect(Array.from(quoteLine).length).toBeLessThanOrEqual(150);
    expect(message).not.toContain("@other");
  });

  it("blocks secret-like quote and motivation text", async () => {
    const message = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-guard",
      urls: [],
      observationSummary: {
        author: "source",
        url: "https://x.com/source/status/1",
        quote: "API_KEY=abcdefghi",
        motivation: "PASSWORD=secret123"
      },
      timestamp: 1
    });

    expect(message).toContain("💬 抜粋: 「[非表示]」");
    expect(message).toContain("🎯 動機: 自分の都市観察と、いまの静かな違和感を、ここに繋いだ。聴いてみて、どうだろう。");
    expect(message).not.toContain("API_KEY");
    expect(message).not.toContain("PASSWORD");
  });
});
