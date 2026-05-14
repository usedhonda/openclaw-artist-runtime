import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { markCallbackResolved, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { routeTelegramCallback, STALE_CALLBACK_JA_REPLY } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-callback-handler-"));
}

function clientMock(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 201, chat: { id: 100 } })
  } as unknown as TelegramClient;
}

async function auditLines(workspace: string): Promise<Array<Record<string, unknown>>> {
  const contents = await readFile(join(workspace, "runtime", "callback-audit.jsonl"), "utf8");
  return contents.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("telegram callback handler", () => {
  it("acks synchronously and fails unsupported pending actions with button cleanup", async () => {
    const workspace = root();
    const client = clientMock();
    const entry = await registerCallbackAction(workspace, {
      action: "unknown_action",
      proposalId: "proposal-1",
      chatId: 100,
      messageId: 200,
      userId: 300,
      now: 1000,
      expiresAt: 5000
    });

    const result = await routeTelegramCallback({
      root: workspace,
      client,
      callbackQueryId: "query-1",
      data: `cb:${entry.callbackId}`,
      fromUserId: 300,
      chatId: 100,
      messageId: 200,
      now: 2000
    });

    expect(result).toMatchObject({ processed: true, result: "failed", reason: "unsupported_action" });
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("query-1", { text: "Unsupported action" });
    expect(client.editMessageReplyMarkup).toHaveBeenCalledWith(100, 200, { inline_keyboard: [] });
    expect(await auditLines(workspace)).toEqual([
      expect.objectContaining({
        callbackId: entry.callbackId,
        action: "unknown_action",
        proposalId: "proposal-1",
        result: "failed",
        reason: "unsupported_action"
      })
    ]);
  });

  it("rejects owner or message mismatches", async () => {
    const workspace = root();
    const client = clientMock();
    const entry = await registerCallbackAction(workspace, {
      action: "proposal_yes",
      chatId: 100,
      messageId: 200,
      userId: 300
    });

    const result = await routeTelegramCallback({
      root: workspace,
      client,
      callbackQueryId: "query-2",
      data: `cb:${entry.callbackId}`,
      fromUserId: 301,
      chatId: 100,
      messageId: 200
    });

    expect(result).toMatchObject({ result: "unauthorized" });
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("query-2", { text: "Not authorized" });
    expect(client.editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it("rejects expired callbacks and missing entries", async () => {
    const workspace = root();
    const client = clientMock();
    const entry = await registerCallbackAction(workspace, {
      action: "proposal_yes",
      chatId: 100,
      messageId: 200,
      userId: 300,
      now: 1000,
      expiresAt: 1500
    });

    await expect(routeTelegramCallback({
      root: workspace,
      client,
      callbackQueryId: "query-3",
      data: `cb:${entry.callbackId}`,
      fromUserId: 300,
      chatId: 100,
      messageId: 200,
      now: 2000
    })).resolves.toMatchObject({ result: "expired", reason: "callback_action_expired" });

    await expect(routeTelegramCallback({
      root: workspace,
      client,
      callbackQueryId: "query-4",
      data: "cb:missing",
      fromUserId: 300,
      chatId: 100,
      messageId: 200
    })).resolves.toMatchObject({ result: "expired", reason: "unknown_callback_blocked" });
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("query-4", { text: STALE_CALLBACK_JA_REPLY });
    expect((await auditLines(workspace)).at(-1)).toMatchObject({
      callbackId: "missing",
      result: "expired",
      reason: "unknown_callback_blocked"
    });
  });

  it("records duplicate presses without re-editing markup", async () => {
    const workspace = root();
    const client = clientMock();
    const entry = await registerCallbackAction(workspace, {
      action: "proposal_yes",
      chatId: 100,
      messageId: 200,
      userId: 300
    });
    await markCallbackResolved(workspace, entry.callbackId, { status: "applied", reason: "done" });

    const result = await routeTelegramCallback({
      root: workspace,
      client,
      callbackQueryId: "query-5",
      data: `cb:${entry.callbackId}`,
      fromUserId: 300,
      chatId: 100,
      messageId: 200
    });

    expect(result).toMatchObject({ result: "duplicate", reason: "already_applied" });
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("query-5", { text: "Already resolved" });
    expect(client.editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it("blocks secret-like callback data before lookup", async () => {
    const workspace = root();
    const client = clientMock();
    const tokenLike = `cb:${"TELEGRAM"}_${"BOT"}_${"TOKEN"}=unsafe123`;

    const result = await routeTelegramCallback({
      root: workspace,
      client,
      callbackQueryId: "query-6",
      data: tokenLike,
      fromUserId: 300,
      chatId: 100,
      messageId: 200
    });

    expect(result).toMatchObject({ result: "failed", reason: "callback_data_contains_secret_like_text" });
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("query-6", { text: "Unsupported action" });
  });
});
