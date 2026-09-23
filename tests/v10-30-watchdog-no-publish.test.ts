import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { registerCallbackAction, resolveCallbackAction } from "../src/services/callbackActionRegistry.js";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler.js";
import type { TelegramClient } from "../src/services/telegramClient.js";
import { executeXPublishAction, hashXPostText } from "../src/services/xPublishActionRegistry.js";

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn(async () => true),
    editMessageReplyMarkup: vi.fn(async () => true),
    editMessageText: vi.fn(async () => true),
    sendMessage: vi.fn(async (chatId: number | string) => ({ message_id: 0, chat: { id: Number(chatId) } }))
  } as unknown as TelegramClient;
}

async function root(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-watchdog-no-publish-"));
  await ensureArtistWorkspace(workspace);
  return workspace;
}

describe("v10.30 watchdog external publish guard", () => {
  it("blocks watchdog actors before daily voice publish can call X", async () => {
    const workspace = await root();
    const entry = await registerCallbackAction(workspace, {
      action: "daily_voice_publish",
      draftText: "今日はここから出す。",
      draftHash: hashXPostText("今日はここから出す。"),
      draftCharCount: 12,
      chatId: 10,
      messageId: 20,
      userId: 30,
      now: 0
    });

    const result = await routeTelegramCallback({
      root: workspace,
      client: client(),
      callbackQueryId: "watchdog:daily",
      data: `cb:${entry.callbackId}`,
      fromUserId: 30,
      chatId: 10,
      messageId: 20,
      actor: "watchdog_recovery",
      now: 1000
    });

    expect(result).toMatchObject({ result: "blocked", reason: "external_publish_actor_guard" });
    await expect(resolveCallbackAction(workspace, entry.callbackId)).resolves.toMatchObject({ status: "pending" });
    const audit = (await readFile(join(workspace, "runtime", "callback-audit.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(audit.at(-1)).toMatchObject({
      callbackId: entry.callbackId,
      action: "daily_voice_publish",
      actor: "watchdog_recovery",
      result: "blocked",
      reason: "external_publish_actor_guard"
    });
  });

  it("blocks watchdog actors before x_publish_confirm can post", async () => {
    const workspace = await root();
    const entry = await registerCallbackAction(workspace, {
      action: "x_publish_confirm",
      songId: "song-x",
      draftText: "できた\nhttps://suno.com/song/abc",
      draftHash: hashXPostText("できた\nhttps://suno.com/song/abc"),
      draftUrl: "https://suno.com/song/abc",
      chatId: 10,
      messageId: 20,
      userId: 30,
      now: 0
    });

    await expect(routeTelegramCallback({
      root: workspace,
      client: client(),
      callbackQueryId: "watchdog:x",
      data: `cb:${entry.callbackId}`,
      fromUserId: 30,
      chatId: 10,
      messageId: 20,
      actor: "watchdog_reprompt",
      now: 1000
    })).resolves.toMatchObject({ result: "blocked", reason: "external_publish_actor_guard" });
    await expect(resolveCallbackAction(workspace, entry.callbackId)).resolves.toMatchObject({ status: "pending" });
  });

  it("also blocks watchdog actors at the X publish registry layer", async () => {
    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "song-x",
      action: "x_publish_confirm",
      actor: "watchdog_recovery",
      finalText: "できた",
      spawnImpl: vi.fn() as never
    })).rejects.toThrow("external_publish_actor_guard");
  });
});
