import { mkdtempSync, readFileSync } from "node:fs";
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

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
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
  it("attaches distribution apply buttons and applies SONGBOOK link from callback", async () => {
    const root = await prepareWorkspace();
    const proposal = proposalForDetection({
      songId: "where-it-played",
      title: "Where It Played",
      platform: "spotify",
      url: "https://open.spotify.com/track/abc",
      detectedAt: "2026-04-29T00:00:00.000Z"
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({
      token: "token",
      chatId: 123,
      workspaceRoot: root,
      aiReviewProvider: "mock",
      fetchImpl
    });

    await notifier.notify({
      type: "distribution_change_detected",
      songId: "where-it-played",
      platform: "spotify",
      url: "https://open.spotify.com/track/abc",
      proposalId: proposal.id,
      proposal,
      timestamp: Date.parse("2026-04-29T00:00:00.000Z")
    });

    const actions = await readCallbackActionEntries(root);
    const apply = actions.find((entry) => entry.action === "dist_apply");
    expect(apply).toMatchObject({ proposalId: proposal.id, songId: "where-it-played", platform: "spotify", messageId: 77, userId: 123 });
    const markupCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    expect(markupCall).toBeTruthy();
    const markupPayload = JSON.parse(String((markupCall?.[1] as RequestInit).body)) as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } };
    expect(markupPayload.reply_markup.inline_keyboard[0]).toEqual([
      { text: "反映する", callback_data: `cb:${apply?.callbackId}` },
      { text: "あとで", callback_data: `cb:${actions.find((entry) => entry.action === "dist_skip")?.callbackId}` }
    ]);

    const client = callbackClient();
    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-apply",
      data: `cb:${apply?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });

    expect(result).toMatchObject({ result: "applied", reason: "applied" });
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toContain("https://open.spotify.com/track/abc");
    expect(client.editMessageText).toHaveBeenCalledWith(123, 77, expect.stringContaining("Applied ✓ spotify for where-it-played"), { replyMarkup: { inline_keyboard: [] } });

    const duplicate = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-apply-again",
      data: `cb:${apply?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    expect(duplicate).toMatchObject({ result: "duplicate", reason: "already_applied" });
  });

  it("skips a distribution proposal without touching SONGBOOK", async () => {
    const root = await prepareWorkspace();
    const proposal = proposalForDetection({
      songId: "where-it-played",
      title: "Where It Played",
      platform: "appleMusic",
      url: "https://music.apple.com/jp/album/where-it-played/123?i=456",
      detectedAt: "2026-04-29T00:00:00.000Z"
    });
    const notifier = new TelegramNotifier({
      token: "token",
      chatId: 123,
      workspaceRoot: root,
      aiReviewProvider: "mock",
      fetchImpl: vi.fn()
        .mockResolvedValueOnce(telegramResponse({ message_id: 88, chat: { id: 123 } }))
        .mockResolvedValueOnce(telegramResponse(true))
    });
    await notifier.notify({
      type: "distribution_change_detected",
      songId: "where-it-played",
      platform: "appleMusic",
      url: proposal.fields[0]?.proposedValue ?? "",
      proposalId: proposal.id,
      proposal,
      timestamp: Date.parse("2026-04-29T00:00:00.000Z")
    });
    const skip = (await readCallbackActionEntries(root)).find((entry) => entry.action === "dist_skip");

    const result = await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "callback-skip",
      data: `cb:${skip?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 88
    });

    expect(result).toMatchObject({ result: "discarded", reason: "discarded" });
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).not.toContain("music.apple.com");
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
