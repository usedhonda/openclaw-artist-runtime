import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AwaitingDecisionPanel, groupAwaitingDecisions } from "../ui/src/components/AwaitingDecisionPanel";
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
    expect(html).toContain("完成後の採用待ち");
    expect(html).not.toContain("take_selection");
    expect(html).toContain("9時間待ち");
    expect(html).toContain("破棄");
    expect(html).toContain("次: Telegram の最新通知で選ぶ");
  });

  it("collapses repeated callbacks by song so the room does not show duplicate action rows", () => {
    const callbacks = [
      {
        callbackId: "cb1",
        action: "song_archive",
        label: "採用",
        effect: "この曲を採用する。",
        songId: "song-026",
        songTitle: "みじかいかげ",
        stage: "take_selection",
        createdAt: Date.parse("2026-05-26T03:00:00.000Z"),
        expiresAt: Date.parse("2026-06-26T03:00:00.000Z")
      },
      {
        callbackId: "cb2",
        action: "song_discard",
        label: "破棄",
        effect: "この曲を破棄する。",
        songId: "song-026",
        songTitle: "みじかいかげ",
        stage: "take_selection",
        createdAt: Date.parse("2026-05-26T03:01:00.000Z"),
        expiresAt: Date.parse("2026-06-26T03:01:00.000Z")
      },
      {
        callbackId: "cb3",
        action: "song_archive",
        label: "採用",
        effect: "この曲を採用する。",
        songId: "song-026",
        songTitle: "みじかいかげ",
        stage: "take_selection",
        createdAt: Date.parse("2026-05-26T03:02:00.000Z"),
        expiresAt: Date.parse("2026-06-26T03:02:00.000Z")
      }
    ];

    const grouped = groupAwaitingDecisions(callbacks);
    const html = renderToStaticMarkup(
      React.createElement(AwaitingDecisionPanel, {
        now: Date.parse("2026-05-26T12:00:00.000Z"),
        count: callbacks.length,
        callbacks
      })
    );

    expect(grouped).toHaveLength(1);
    expect(grouped[0].actions).toEqual(["採用", "破棄"]);
    expect(grouped[0].hiddenDuplicateCount).toBe(2);
    expect(html.split("song-026 / みじかいかげ").length - 1).toBe(1);
    expect(html).toContain("古い重複通知 2 件をまとめています。");
    expect(html).toContain("表示は曲単位にまとめています。");
  });

  it("can limit the Room surface to the latest decision group", () => {
    const html = renderToStaticMarkup(
      React.createElement(AwaitingDecisionPanel, {
        now: Date.parse("2026-05-26T12:00:00.000Z"),
        count: 2,
        maxGroups: 1,
        callbacks: [
          {
            callbackId: "cb1",
            action: "song_archive",
            label: "採用",
            effect: "この曲を採用する。",
            songId: "song-new",
            songTitle: "新しい曲",
            stage: "asset_generation",
            createdAt: Date.parse("2026-05-26T11:00:00.000Z"),
            expiresAt: Date.parse("2026-06-26T11:00:00.000Z")
          },
          {
            callbackId: "cb2",
            action: "song_discard",
            label: "破棄",
            effect: "この曲を破棄する。",
            songId: "song-old",
            songTitle: "古い曲",
            stage: "asset_generation",
            createdAt: Date.parse("2026-05-25T11:00:00.000Z"),
            expiresAt: Date.parse("2026-06-25T11:00:00.000Z")
          }
        ]
      })
    );

    expect(html).toContain("song-new / 新しい曲");
    expect(html).not.toContain("song-old / 古い曲");
    expect(html).toContain("ほか 1 曲の判断待ちは畳んでいます。");
  });

  it("prefers the current archive decision family over stale spawn proposal callbacks", () => {
    const callbacks = [
      {
        callbackId: "archive",
        action: "song_archive",
        label: "採用",
        effect: "この曲を採用する。",
        songId: "song-026",
        songTitle: "みじかいかげ",
        stage: "asset_generation",
        createdAt: Date.parse("2026-05-26T03:00:00.000Z"),
        expiresAt: Date.parse("2026-06-26T03:00:00.000Z")
      },
      {
        callbackId: "discard",
        action: "song_discard",
        label: "破棄",
        effect: "この曲を破棄する。",
        songId: "song-026",
        songTitle: "みじかいかげ",
        stage: "asset_generation",
        createdAt: Date.parse("2026-05-26T03:00:00.000Z"),
        expiresAt: Date.parse("2026-06-26T03:00:00.000Z")
      },
      {
        callbackId: "stale-edit",
        action: "song_spawn_edit",
        label: "修正する",
        effect: "この commission を編集する。",
        songId: "song-026",
        proposalId: "song-026",
        stage: "asset_generation",
        createdAt: Date.parse("2026-05-25T03:00:00.000Z"),
        expiresAt: Date.parse("2026-06-25T03:00:00.000Z")
      }
    ];

    const grouped = groupAwaitingDecisions(callbacks);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].actions).toEqual(["採用", "破棄"]);
    expect(grouped[0].actions).not.toContain("修正する");
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

    expect(response.count).toBe(2);
    expect(response.callbacks.find((callback) => callback.action === "song_archive")).toMatchObject({
      action: "song_archive",
      category: "producer_decision",
      songTitle: "みじかいかげ",
      stage: "asset_generation"
    });
    expect(response.callbacks.find((callback) => callback.action === "prompt_pack_go")).toMatchObject({
      action: "prompt_pack_go",
      category: "producer_decision"
    });
  });
});
