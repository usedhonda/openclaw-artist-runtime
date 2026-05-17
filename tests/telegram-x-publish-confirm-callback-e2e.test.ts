import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState, updateSongState } from "../src/services/artistState";
import { readCallbackActionEntries, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import { TelegramNotifier } from "../src/services/telegramNotifier";
import { hashXPostText } from "../src/services/xPublishActionRegistry";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-x-callback-"));
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

function mockSpawn(results: Array<{ code?: number | null; stdout?: string; stderr?: string }>) {
  return ((_command: string, args: string[]) => {
    const result = results.shift() ?? { code: 0, stdout: "" };
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void; args?: string[] };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    child.args = args;
    process.nextTick(() => {
      if (result.stdout) child.stdout.emit("data", result.stdout);
      if (result.stderr) child.stderr.emit("data", result.stderr);
      child.emit("close", result.code ?? 0);
    });
    return child;
  }) as never;
}

async function prepareRoot(): Promise<string> {
  const root = workspace();
  await ensureArtistWorkspace(root);
  await updateSongState(root, "where-it-played", {
    title: "Where It Played",
    status: "take_selected",
    selectedTakeId: "take-1",
    appendPublicLinks: ["https://suno.example/take-1"]
  });
  return root;
}

describe("telegram X publish callbacks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs Journey I: prepare preview, confirm tweet, record SONGBOOK, and reject duplicate taps", async () => {
    const root = await prepareRoot();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl });
    await notifier.notify({
      type: "song_take_completed",
      songId: "where-it-played",
      selectedTakeId: "take-1",
      urls: ["https://suno.example/take-1"],
      timestamp: Date.parse("2026-04-29T00:00:00.000Z")
    });
    const prepare = (await readCallbackActionEntries(root)).find((entry) => entry.action === "x_publish_prepare");
    expect(prepare).toMatchObject({ songId: "where-it-played", draftUrl: "https://suno.example/take-1", messageId: 77 });

    const client = callbackClient();
    const prepared = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "prepare",
      data: `cb:${prepare?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    expect(prepared).toMatchObject({ result: "applied", reason: "prepared" });
    expect(client.editMessageText).toHaveBeenCalledWith(123, 77, expect.stringContaining("X post preview:"), expect.objectContaining({
      replyMarkup: expect.objectContaining({ inline_keyboard: expect.any(Array) })
    }));

    const confirm = (await readCallbackActionEntries(root)).find((entry) => entry.action === "x_publish_confirm");
    expect(confirm?.draftHash).toBeTruthy();
    const published = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "confirm",
      data: `cb:${confirm?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77,
      xPublishSpawnImpl: mockSpawn([
        { code: 0, stdout: "@used_honda" },
        { code: 0, stdout: "posted https://x.com/used_honda/status/1234567890" }
      ])
    });
    expect(published).toMatchObject({ result: "applied", reason: "published" });
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toContain("https://x.com/used_honda/status/1234567890");
    expect((await readSongState(root, "where-it-played")).status).toBe("published");
    expect(client.editMessageText).toHaveBeenLastCalledWith(123, 77, expect.stringContaining("X投稿完了"), { replyMarkup: { inline_keyboard: [] } });

    const duplicate = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "confirm-again",
      data: `cb:${confirm?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    expect(duplicate).toMatchObject({ result: "duplicate", reason: "already_applied" });
  });

  it("detects hash mismatch, auth failures, cancel, and old callbacks when disabled", async () => {
    const root = await prepareRoot();
    const client = callbackClient();
    const badHash = await registerCallbackAction(root, {
      action: "x_publish_confirm",
      songId: "where-it-played",
      draftText: "changed",
      draftHash: hashXPostText("original"),
      chatId: 123,
      messageId: 10,
      userId: 123
    });
    await expect(routeTelegramCallback({
      root,
      client,
      callbackQueryId: "bad-hash",
      data: `cb:${badHash.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 10,
      xPublishSpawnImpl: mockSpawn([])
    })).resolves.toMatchObject({ result: "failed", reason: "x_publish_hash_mismatch" });

    const authMissing = await registerCallbackAction(root, {
      action: "x_publish_confirm",
      songId: "where-it-played",
      draftText: "draft",
      draftHash: hashXPostText("draft"),
      chatId: 123,
      messageId: 11,
      userId: 123
    });
    await expect(routeTelegramCallback({
      root,
      client,
      callbackQueryId: "auth-missing",
      data: `cb:${authMissing.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 11,
      xPublishSpawnImpl: mockSpawn([{ code: 1, stderr: "missing auth cookie" }])
    })).resolves.toMatchObject({ result: "failed", reason: "bird_auth_missing" });

    const cancel = await registerCallbackAction(root, { action: "x_publish_cancel", songId: "where-it-played", chatId: 123, messageId: 12, userId: 123 });
    await expect(routeTelegramCallback({
      root,
      client,
      callbackQueryId: "cancel",
      data: `cb:${cancel.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 12
    })).resolves.toMatchObject({ result: "discarded", reason: "cancelled" });

    vi.stubEnv("OPENCLAW_X_INLINE_BUTTON", "off");
    const disabled = await registerCallbackAction(root, { action: "x_publish_prepare", songId: "where-it-played", chatId: 123, messageId: 13, userId: 123 });
    await expect(routeTelegramCallback({
      root,
      client,
      callbackQueryId: "disabled",
      data: `cb:${disabled.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 13
    })).resolves.toMatchObject({ result: "failed", reason: "x_inline_button_disabled" });
  });

  it("hides the X button when the retreat flag is off", async () => {
    vi.stubEnv("OPENCLAW_X_INLINE_BUTTON", "off");
    const root = await prepareRoot();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 55, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl }).notify({
      type: "song_take_completed",
      songId: "where-it-played",
      urls: ["https://suno.example/take-1"],
      timestamp: Date.now()
    });
    expect((await readCallbackActionEntries(root)).map((entry) => entry.action).sort()).toEqual(["song_archive", "song_discard", "song_skip", "song_songbook_write"].sort());
    const markupCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    expect(String((markupCall?.[1] as RequestInit).body)).not.toContain("X 投稿準備");
  });
});
