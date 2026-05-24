import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it, vi } from "vitest";
import { buildSongCascadeTrace, ProducerReviewButtons } from "../ui/src/components/SongDetailCard";

describe("SongDetailCard producer review buttons", () => {
  it("renders archive/discard buttons with plain JA action labels", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProducerReviewButtons, {
        onArchive: vi.fn(),
        onDiscard: vi.fn()
      })
    );

    expect(html).toContain("採用して次の曲へ");
    expect(html).toContain("破棄して次の曲へ");
    expect(html).not.toMatch(/publish|SNS|artist voice/i);
  });

  it("derives cascade trace fields from the song detail brief", () => {
    const trace = buildSongCascadeTrace({
      song: {
        songId: "song-1",
        title: "コピー機の夜景",
        lastReason: "ゆずるさん、ここで切る。"
      },
      brief: [
        "- Lyrics theme: コピー機の白い光を夜の孤独として切る。",
        "- Style notes: low bass, dry drums",
        "- Quote: 深夜のコピー機だけがまだ働いている",
        "- URL: https://x.com/office/status/12345"
      ].join("\n")
    }, "song-1");

    expect(trace).not.toBeNull();
    expect(trace?.title).toBe("コピー機の夜景");
    expect(trace?.lyricsTheme).toContain("コピー機の白い光");
    expect(trace?.styleLayer).toContain("low bass");
    expect(trace?.observationSources[0]?.url).toBe("https://x.com/office/status/12345");
  });

  it("prefers the normalized API cascadeTrace field when present", () => {
    const trace = buildSongCascadeTrace({
      cascadeTrace: {
        observationSources: [{ label: "api", quote: "API source", url: "https://x.com/api/status/1" }],
        artistVoice: "API voice",
        title: "API title",
        lyricsTheme: "API lyrics",
        styleLayer: "API style"
      },
      brief: "- Lyrics theme: local"
    }, "song-1");

    expect(trace?.title).toBe("API title");
    expect(trace?.lyricsTheme).toBe("API lyrics");
    expect(trace?.observationSources[0]?.quote).toBe("API source");
  });
});
