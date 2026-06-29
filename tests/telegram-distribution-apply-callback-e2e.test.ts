import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { updateSongState } from "../src/services/artistState";
import { readCallbackActionEntries, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import { TelegramNotifier } from "../src/services/telegramNotifier";
import { proposalForDetection } from "../src/services/songDistributionPoller";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-dist-callback-"));
}

function callbackClient(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 99, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

async function prepareWorkspace(): Promise<string> {
  const root = workspace();
  await ensureArtistWorkspace(root);
  await updateSongState(root, "where-it-played", { title: "Where It Played", status: "scheduled" });
  return root;
}

describe("telegram distribution apply callbacks", () => {
  it("keeps distribution detections out of Telegram and does not mint apply buttons", async () => {
    const root = await prepareWorkspace();
    const proposal = proposalForDetection({
      songId: "where-it-played",
      title: "Where It Played",
      platform: "spotify",
      url: "https://open.spotify.com/track/abc",
      detectedAt: "2026-04-29T00:00:00.000Z"
    });
    const fetchImpl = vi.fn();
    await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl }).notify({
      type: "distribution_change_detected",
      songId: "where-it-played",
      platform: "spotify",
      url: "https://open.spotify.com/track/abc",
      proposalId: proposal.id,
      proposal,
      timestamp: Date.parse("2026-04-29T00:00:00.000Z")
    });

    const actions = await readCallbackActionEntries(root);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(actions.some((entry) => entry.action === "dist_apply" || entry.action === "dist_skip")).toBe(false);
  });

  it("keeps distribution skip prompts out of Telegram", async () => {
    const root = await prepareWorkspace();
    const proposal = proposalForDetection({
      songId: "where-it-played",
      title: "Where It Played",
      platform: "appleMusic",
      url: "https://music.apple.com/jp/album/where-it-played/123?i=456",
      detectedAt: "2026-04-29T00:00:00.000Z"
    });
    const fetchImpl = vi.fn();
    await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl }).notify({
      type: "distribution_change_detected",
      songId: "where-it-played",
      platform: "appleMusic",
      url: proposal.fields[0]?.proposedValue ?? "",
      proposalId: proposal.id,
      proposal,
      timestamp: Date.parse("2026-04-29T00:00:00.000Z")
    });

    const actions = await readCallbackActionEntries(root);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(actions.some((entry) => entry.action === "dist_apply" || entry.action === "dist_skip")).toBe(false);
  });

  it("expires old distribution callback actions", async () => {
    const root = await prepareWorkspace();
    const entry = await registerCallbackAction(root, {
      action: "dist_apply",
      proposalId: "distribution-old",
      songId: "where-it-played",
      platform: "spotify",
      chatId: 123,
      messageId: 77,
      userId: 123,
      now: 1000,
      expiresAt: 1500
    });
    const client = callbackClient();

    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-expired",
      data: `cb:${entry.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77,
      now: 2000
    });

    expect(result).toMatchObject({ result: "expired", reason: "callback_action_expired" });
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("callback-expired", { text: "Expired" });
  });
});
