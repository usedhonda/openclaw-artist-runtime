import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-callback-audit-"));
}

function clientMock(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 2 } })
  } as unknown as TelegramClient;
}

async function readAudit(root: string): Promise<Array<Record<string, unknown>>> {
  const contents = await readFile(join(root, "runtime", "callback-audit.jsonl"), "utf8");
  return contents.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("callback audit log", () => {
  it("records hashed actor ids and action metadata without raw chat text", async () => {
    const root = workspace();
    const entry = await registerCallbackAction(root, {
      action: "dist_apply",
      proposalId: "proposal-1",
      songId: "where-it-played",
      platform: "spotify",
      chatId: 123456,
      messageId: 789,
      userId: 654321,
      now: 1000
    });

    await routeTelegramCallback({
      root,
      client: clientMock(),
      callbackQueryId: "query-1",
      data: `cb:${entry.callbackId}`,
      fromUserId: 654321,
      chatId: 123456,
      messageId: 789,
      now: 2000
    });

    const [audit] = await readAudit(root);
    expect(audit).toMatchObject({
      timestamp: 2000,
      callbackId: entry.callbackId,
      action: "dist_apply",
      proposalId: "proposal-1",
      songId: "where-it-played",
      platform: "spotify",
      result: "duplicate",
      reason: "already_resolved"
    });
    expect(typeof audit.chatIdHash).toBe("string");
    expect(typeof audit.userIdHash).toBe("string");
    expect(audit.chatIdHash).not.toBe("123456");
    expect(audit.userIdHash).not.toBe("654321");
    expect(audit).not.toHaveProperty("chatId");
    expect(audit).not.toHaveProperty("userId");
    expect(audit).not.toHaveProperty("messageId");
    expect(audit).not.toHaveProperty("data");
    expect(JSON.stringify(audit)).not.toContain("producer raw message");
  });
});
