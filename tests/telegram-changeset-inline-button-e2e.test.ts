import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCallbackActionEntries, registerCallbackAction } from "../src/services/callbackActionRegistry";
import * as changeSetApplier from "../src/services/changeSetApplier";
import { readConversationalSession } from "../src/services/conversationalSession";
import { TelegramBotWorker } from "../src/services/telegramBotWorker";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";
import type { TelegramClient } from "../src/services/telegramClient";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-inline-button-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: Before\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Conversation tone: direct\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "state\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "voice\n", "utf8");
  return root;
}

function clientMock(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 51, chat: { id: 2 } })
  } as unknown as TelegramClient;
}

describe("telegram ChangeSet inline button e2e", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates proposal button metadata and applies the proposal from callback once", async () => {
    const root = await workspace();
    const proposed = await routeTelegramCommand({
      text: "/persona persona をもっと鋭く変えて",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });
    const proposalId = proposed.proposalButtons?.proposalId;
    expect(proposalId).toMatch(/^changeset-persona-/);
    const sessionProposal = (await readConversationalSession(root, 2, 1))?.pendingChangeSet;
    expect(sessionProposal?.id).toBe(proposalId);

    const applySpy = vi.spyOn(changeSetApplier, "applyChangeSet").mockResolvedValue({
      applied: sessionProposal?.fields ?? [],
      skipped: [],
      warnings: [],
      backups: { sessionId: proposalId ?? "missing", entries: [] }
    });
    const entry = await registerCallbackAction(root, {
      action: "proposal_yes",
      proposalId,
      chatId: 2,
      messageId: 50,
      userId: 1
    });
    const client = clientMock();

    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-1",
      data: `cb:${entry.callbackId}`,
      fromUserId: 1,
      chatId: 2,
      messageId: 50
    });

    expect(result).toMatchObject({ result: "applied", reason: "applied" });
    expect(client.answerCallbackQuery).toHaveBeenCalledWith("callback-1", { text: "OK" });
    expect(client.editMessageReplyMarkup).toHaveBeenCalledWith(2, 50, { inline_keyboard: [] });
    expect(client.sendMessage).toHaveBeenCalledWith(2, expect.stringContaining("Applied."), undefined);
    expect(applySpy).toHaveBeenCalledOnce();

    const second = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-2",
      data: `cb:${entry.callbackId}`,
      fromUserId: 1,
      chatId: 2,
      messageId: 50
    });

    expect(second).toMatchObject({ result: "duplicate", reason: "already_applied" });
    expect(applySpy).toHaveBeenCalledOnce();
  });

  it("attaches inline buttons after Telegram assigns a message id", async () => {
    const root = await workspace();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 1,
            message: {
              message_id: 10,
              chat: { id: 2 },
              from: { id: 1 },
              text: "/persona persona をもっと鋭く変えて"
            }
          }
        ]
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 77, chat: { id: 2 } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: true })));
    const worker = new TelegramBotWorker({
      root,
      config: { enabled: true, pollIntervalMs: 1000, notifyStages: true, acceptFreeText: true },
      token: "token",
      ownerUserIds: new Set(["1"]),
      fetchImpl
    });

    const result = await worker.pollOnce();

    expect(result).toMatchObject({ processed: 1 });
    const editCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    expect(editCall).toBeTruthy();
    const payload = JSON.parse(String((editCall?.[1] as RequestInit).body)) as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } };
    expect(payload.reply_markup.inline_keyboard.flat().map((button) => button.callback_data)).toHaveLength(3);
    expect(payload.reply_markup.inline_keyboard.flat().every((button) => button.callback_data.startsWith("cb:"))).toBe(true);
    expect(await readCallbackActionEntries(root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "proposal_yes", messageId: 77, status: "pending" }),
      expect.objectContaining({ action: "proposal_no", messageId: 77, status: "pending" }),
      expect.objectContaining({ action: "proposal_edit_open", messageId: 77, status: "pending" })
    ]));
  });

  it("opens edit guidance without accepting field updates through callback data", async () => {
    const root = await workspace();
    const proposed = await routeTelegramCommand({
      text: "/persona persona をもっと鋭く変えて",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });
    const entry = await registerCallbackAction(root, {
      action: "proposal_edit_open",
      proposalId: proposed.proposalButtons?.proposalId,
      chatId: 2,
      messageId: 50,
      userId: 1
    });
    const client = clientMock();

    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "callback-edit",
      data: `cb:${entry.callbackId}`,
      fromUserId: 1,
      chatId: 2,
      messageId: 50
    });

    expect(result).toMatchObject({ result: "updated", reason: "updated" });
    expect(client.sendMessage).toHaveBeenCalledWith(2, expect.stringContaining("/edit <field> <value>"));
    expect(client.editMessageReplyMarkup).toHaveBeenCalledWith(2, 50, { inline_keyboard: [] });
  });
});
