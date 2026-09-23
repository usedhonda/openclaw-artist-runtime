import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it } from "vitest";
import { describeCallbackActionEffect, registerCallbackAction, summarizePendingCallbackActions } from "../src/services/callbackActionRegistry";
import { SystemStatusOverview } from "../ui/src/components/SystemStatusOverview";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("system status overview", () => {
  it("renders current stage, Suno state, and button effects in one card", () => {
    const html = renderToStaticMarkup(
      React.createElement(SystemStatusOverview, {
        now: Date.parse("2026-05-16T00:00:00.000Z"),
        status: {
          autopilot: {
            stage: "prompt_pack",
            nextAction: "waiting for producer GO",
            currentSongId: "song-018",
            blockedReason: "prompt_pack_ready"
          },
          ticker: {
            lastOutcome: "skipped:paused",
            lastTickAt: "2026-05-15T23:50:00.000Z",
            intervalMs: 300000
          },
          sunoWorker: {
            state: "connected",
            connected: true,
            currentRunId: "run-1",
            lastImportedRunId: "run-0"
          },
          recentSong: {
            songId: "song-018",
            title: "コピー機の夜景",
            status: "prompt_pack"
          },
          pendingCallbacks: {
            count: 1,
            recent: [
              {
                callbackId: "cb1",
                action: "prompt_pack_go",
                label: "Suno 生成へ",
                effect: "prompt_pack の停止を解除し、次 cycle で Suno 生成へ進めます。",
                songId: "song-018",
                createdAt: Date.parse("2026-05-15T23:55:00.000Z"),
                expiresAt: Date.parse("2026-05-16T01:00:00.000Z")
              }
            ]
          },
          failedNotifications: {
            count: 1,
            recent: [
              {
                notifyId: "notify1",
                eventType: "prompt_pack_ready",
                songId: "spawn_c6ad5e",
                errorMessage: "fetch failed",
                attempts: 3,
                failedAt: "2026-05-15T23:56:00.000Z"
              }
            ]
          }
        }
      })
    );

    expect(html).toContain("System Status Overview");
    expect(html).toContain("prompt_pack");
    expect(html).toContain("prompt_pack_ready");
    expect(html).toContain("connected");
    expect(html).toContain("Suno 生成へ");
    expect(html).toContain("次 cycle で Suno 生成へ進めます。");
    expect(html).toContain("Telegram 通知失敗");
    expect(html).toContain("prompt_pack_ready");
    expect(html).toContain("再送");
  });

  it("summarizes only live pending callbacks with deterministic effects", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-system-status-"));
    const now = Date.parse("2026-05-16T00:00:00.000Z");
    await registerCallbackAction(root, {
      action: "prompt_pack_go",
      songId: "song-018",
      chatId: 1,
      messageId: 2,
      userId: 1,
      now,
      expiresAt: now + 60_000
    });
    await registerCallbackAction(root, {
      action: "song_spawn_skip",
      songId: "spawn_old",
      chatId: 1,
      messageId: 3,
      userId: 1,
      now: now - 120_000,
      expiresAt: now - 60_000
    });

    const summary = await summarizePendingCallbackActions(root, 8, now);

    expect(summary.count).toBe(1);
    expect(summary.recent[0]).toMatchObject({
      action: "prompt_pack_go",
      label: "Suno 生成へ",
      effect: expect.stringContaining("停止を解除")
    });
    expect(describeCallbackActionEffect("x_publish_confirm").effect).toContain("外部公開");
  });
});
