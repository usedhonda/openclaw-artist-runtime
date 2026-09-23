import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimeActionMirrorCard,
  submitDistributionMirrorAction,
  submitSongMirrorAction,
  supportedRuntimeActionEvents
} from "../ui/src/components/RuntimeActionMirrorCard";

describe("producer console runtime action mirror", () => {
  it("renders distribution and song completion actions without real publish buttons", () => {
    const html = renderToStaticMarkup(
      React.createElement(RuntimeActionMirrorCard, {
        busy: false,
        events: [
          {
            type: "distribution_change_detected",
            songId: "where-it-played",
            platform: "spotify",
            url: "https://open.spotify.com/track/test",
            proposalId: "proposal-dist-1",
            timestamp: 1777400000000
          },
          {
            type: "song_take_completed",
            songId: "where-it-played",
            selectedTakeId: "take-1",
            urls: ["https://suno.com/song/test"],
            timestamp: 1777400001000
          }
        ],
        onDistributionApply: vi.fn(),
        onDistributionSkip: vi.fn(),
        onSongbookWrite: vi.fn(),
        onSongbookSkip: vi.fn()
      })
    );

    expect(html).toContain("Callback Action Mirror");
    expect(html).toContain("Distribution URL");
    expect(html).toContain("Reflect URL");
    expect(html).toContain("Song Completion");
    expect(html).toContain("SONGBOOK 反映");
    expect(html).not.toMatch(/X 投稿|Instagram|TikTok/);
  });

  it("filters supported runtime events and calls mirror handlers", async () => {
    const events = supportedRuntimeActionEvents([
      { type: "theme_generated", theme: "skip", reason: "out", timestamp: 1 },
      { type: "song_take_completed", songId: "song-1", timestamp: 2 },
      { type: "distribution_change_detected", songId: "song-1", platform: "appleMusic", url: "https://music.apple.com/test", proposalId: "p1", timestamp: 3 }
    ]);
    expect(events.map((event) => event.type)).toEqual(["song_take_completed", "distribution_change_detected"]);

    const onDistributionApply = vi.fn();
    const onDistributionSkip = vi.fn();
    const onSongbookWrite = vi.fn();
    const onSongbookSkip = vi.fn();

    await submitDistributionMirrorAction("apply", "p1", { onDistributionApply, onDistributionSkip });
    await submitDistributionMirrorAction("skip", "p1", { onDistributionApply, onDistributionSkip });
    await submitSongMirrorAction("write", "song-1", { onSongbookWrite, onSongbookSkip });
    await submitSongMirrorAction("skip", "song-1", { onSongbookWrite, onSongbookSkip });

    expect(onDistributionApply).toHaveBeenCalledWith("p1");
    expect(onDistributionSkip).toHaveBeenCalledWith("p1");
    expect(onSongbookWrite).toHaveBeenCalledWith("song-1");
    expect(onSongbookSkip).toHaveBeenCalledWith("song-1");
  });
});
