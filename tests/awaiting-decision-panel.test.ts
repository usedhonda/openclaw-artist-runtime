import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AwaitingDecisionPanel } from "../ui/src/components/AwaitingDecisionPanel";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { buildCallbackActionsResponse } from "../src/routes";

describe("awaiting decision panel", () => {
  it("renders pending producer decisions with effect text", () => {
    const html = renderToStaticMarkup(
      React.createElement(AwaitingDecisionPanel, {
        now: Date.parse("2026-05-26T12:00:00.000Z"),
        count: 1,
        callbacks: [
          {
            callbackId: "cb1",
            action: "song_discard",
            label: "破棄",
            effect: "この曲を破棄し、次の曲作りへ進める。",
            songId: "song-026",
            songTitle: "みじかいかげ",
            stage: "take_selection",
            createdAt: Date.parse("2026-05-26T03:00:00.000Z"),
            expiresAt: Date.parse("2026-06-26T03:00:00.000Z")
          }
        ]
      })
    );

    expect(html).toContain("Awaiting Producer Decision");
    expect(html).toContain("song-026 / みじかいかげ");
    expect(html).toContain("take_selection");
    expect(html).toContain("9時間待ち");
    expect(html).toContain("破棄");
  });

  it("exposes producer decision callbacks through the callback-actions route response", async () => {
    const root = await mkdtemp(join(tmpdir(), "artist-runtime-awaiting-decision-"));
    const now = Date.now();
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-026", "みじかいかげ");
    await updateSongState(root, "song-026", { status: "take_selected", reason: "test" });
    await registerCallbackAction(root, {
      action: "song_archive",
      songId: "song-026",
      chatId: 1,
      messageId: 2,
      userId: 1,
      now
    });
    await registerCallbackAction(root, {
      action: "prompt_pack_go",
      songId: "song-026",
      chatId: 1,
      messageId: 3,
      userId: 1,
      now
    });

    const response = await buildCallbackActionsResponse({
      config: { artist: { workspaceRoot: root } },
      requestPath: "/plugins/artist-runtime/api/callback-actions?status=pending&category=producer_decision"
    });

    expect(response.count).toBe(1);
    expect(response.callbacks[0]).toMatchObject({
      action: "song_archive",
      category: "producer_decision",
      songTitle: "みじかいかげ",
      stage: "asset_generation"
    });
  });
});
