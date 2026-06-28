import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it, vi } from "vitest";
import { buildSongCascadeTrace, DetailPager, producerObservationLabel, producerReasonLabel, producerStyleLabel, ProducerReviewButtons } from "../ui/src/components/SongDetailCard";

describe("SongDetailCard producer review buttons", () => {
  it("renders archive/discard buttons with plain JA action labels", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProducerReviewButtons, {
        onArchive: vi.fn(),
        onDiscard: vi.fn()
      })
    );

    expect(html).toContain("採用");
    expect(html).toContain("破棄");
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

  it("renders compact paging controls for long detail lists", () => {
    const html = renderToStaticMarkup(
      React.createElement(DetailPager, {
        page: 1,
        total: 21,
        onPage: vi.fn()
      })
    );

    expect(html).toContain("9-16 / 21");
    expect(html).toContain("前へ");
    expect(html).toContain("次へ");
  });

  it("maps technical take-selection reasons to producer-facing copy", () => {
    expect(producerReasonLabel("selected best scored take (0.796)")).toBe("試聴用テイクを自動選択しました。");
    expect(producerReasonLabel("歌詞生成に失敗して止まった")).toBe("歌詞生成に失敗して止まった");
  });

  it("hides technical cascade labels and English style prose from the producer surface", () => {
    expect(producerObservationLabel({ label: "brief source" })).toBe("記録済みの観察");
    expect(producerStyleLabel("aggressive jazz drums up front, thick electric bass")).toBe("プロンプト台帳に記録");
    expect(producerStyleLabel("低いベースと乾いたドラム")).toBe("低いベースと乾いたドラム");
  });
});
