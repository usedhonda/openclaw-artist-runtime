import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { updateSongState } from "../src/services/artistState";
import { registerCallbackAction, readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import * as changeSetApplier from "../src/services/changeSetApplier";
import { createConversationalSession } from "../src/services/conversationalSession";
import type { ChangeSetProposal } from "../src/services/freeformChangesetProposer";
import { readResolvedConfig } from "../src/services/runtimeConfig";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import { TelegramNotifier } from "../src/services/telegramNotifier";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-r10-callback-"));
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

function proposal(id: string, songId = "where-it-played"): ChangeSetProposal {
  return {
    id,
    domain: "song",
    summary: "Song status update.",
    fields: [
      {
        domain: "song",
        targetFile: `songs/${songId}/song.md`,
        field: "status",
        currentValue: "scheduled",
        proposedValue: "published",
        reasoning: "operator approved local reflection",
        status: "proposed"
      }
    ],
    warnings: [],
    createdAt: "2026-04-29T00:00:00.000Z",
    source: "conversation",
    songId
  };
}

async function r10Snapshot(root: string): Promise<Record<string, unknown>> {
  const config = await readResolvedConfig(root);
  return {
    dryRun: config.autopilot.dryRun,
    liveGoArmed: config.distribution.liveGoArmed,
    xLiveGoArmed: config.distribution.platforms.x.liveGoArmed,
    instagramLiveGoArmed: config.distribution.platforms.instagram.liveGoArmed,
    tiktokLiveGoArmed: config.distribution.platforms.tiktok.liveGoArmed
  };
}

async function prepareRoot(): Promise<string> {
  const root = workspace();
  await ensureArtistWorkspace(root);
  await updateSongState(root, "where-it-played", { title: "Where It Played", status: "scheduled" });
  return root;
}

describe("R10 callback safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps dryRun and liveGoArmed unchanged across proposal and distribution callbacks", async () => {
    const root = await prepareRoot();
    const before = await r10Snapshot(root);
    const pending = proposal("r10-proposal");
    await createConversationalSession(root, {
      chatId: 123,
      userId: 123,
      topic: { kind: "song", songId: "where-it-played" },
      pendingChangeSet: pending
    });
    vi.spyOn(changeSetApplier, "applyChangeSet").mockResolvedValue({
      applied: pending.fields,
      skipped: [],
      warnings: [],
      backups: { sessionId: pending.id, entries: [] }
    });
    const actions = await Promise.all([
      registerCallbackAction(root, { action: "proposal_yes", proposalId: pending.id, chatId: 123, messageId: 10, userId: 123 }),
      registerCallbackAction(root, { action: "proposal_no", proposalId: "already-cleared", chatId: 123, messageId: 11, userId: 123 }),
      registerCallbackAction(root, { action: "proposal_edit_open", proposalId: "already-cleared", chatId: 123, messageId: 12, userId: 123 }),
      registerCallbackAction(root, { action: "dist_apply", proposalId: "already-cleared", songId: "where-it-played", platform: "spotify", chatId: 123, messageId: 13, userId: 123 }),
      registerCallbackAction(root, { action: "dist_skip", proposalId: "already-cleared", songId: "where-it-played", platform: "spotify", chatId: 123, messageId: 14, userId: 123 })
    ]);

    for (const action of actions) {
      await routeTelegramCallback({
        root,
        client: callbackClient(),
        callbackQueryId: `cb-${action.action}`,
        data: `cb:${action.callbackId}`,
        fromUserId: 123,
        chatId: 123,
        messageId: action.messageId
      });
    }

    expect(await r10Snapshot(root)).toEqual(before);
  });

  it("keeps dryRun and liveGoArmed unchanged across song completion callbacks", async () => {
    const root = await prepareRoot();
    const before = await r10Snapshot(root);
    const write = await registerCallbackAction(root, { action: "song_songbook_write", songId: "where-it-played", chatId: 123, messageId: 20, userId: 123 });
    const skip = await registerCallbackAction(root, { action: "song_skip", songId: "where-it-played", chatId: 123, messageId: 21, userId: 123 });

    await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "cb-song-write",
      data: `cb:${write.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 20
    });
    await routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "cb-song-skip",
      data: `cb:${skip.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 21
    });

    expect(await r10Snapshot(root)).toEqual(before);
  });

  it("exposes only SONGBOOK, skip, and X prep buttons on song completion notifications", async () => {
    const root = await prepareRoot();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 55, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl });

    await notifier.notify({
      type: "song_take_completed",
      songId: "where-it-played",
      selectedTakeId: "take-1",
      urls: ["https://suno.example/take-1"],
      timestamp: Date.now()
    });

    const actions = await readCallbackActionEntries(root);
    expect(actions.map((entry) => entry.action).sort()).toEqual(["song_archive", "song_discard", "song_skip", "song_songbook_write", "x_publish_prepare"].sort());
    const markupCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    const body = JSON.parse(String((markupCall?.[1] as RequestInit).body)) as { reply_markup: unknown };
    const replyMarkup = body.reply_markup as { inline_keyboard?: Array<Array<unknown>> };
    expect(replyMarkup.inline_keyboard?.every((row) => row.length <= 2)).toBe(true);
    const buttonText = JSON.stringify(body.reply_markup, (_key, value) => _key === "callback_data" ? undefined : value);
    expect(buttonText).toContain("SONGBOOK.md に追記");
    expect(buttonText).toContain("X 草案を作る");
    expect(buttonText).not.toMatch(/Instagram|TikTok|IG/i);
  });
});
