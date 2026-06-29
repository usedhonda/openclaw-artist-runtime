import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TelegramConfig } from "../src/types";
import { TelegramBotWorker } from "../src/services/telegramBotWorker";
import { listPendingCallbackActionSummaries, readCallbackActionEntries, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { ensureSongState, updateSongState } from "../src/services/artistState";

const enabledConfig: TelegramConfig = {
  enabled: true,
  pollIntervalMs: 2000,
  notifyStages: true,
  acceptFreeText: true
};

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-telegram-worker-"));
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as Response;
}

describe("telegram bot worker", () => {
  it("stays disabled with config off and never fetches", async () => {
    const fetchImpl = vi.fn();
    const worker = new TelegramBotWorker({
      root: makeRoot(),
      config: { ...enabledConfig, enabled: false },
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.start();

    expect(result).toMatchObject({ enabled: false, fetched: false, reason: "disabled_config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stays disabled when the token is missing and never fetches", async () => {
    const fetchImpl = vi.fn();
    const worker = new TelegramBotWorker({
      root: makeRoot(),
      config: enabledConfig,
      token: "",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.start();

    expect(result).toMatchObject({ enabled: false, fetched: false, reason: "missing_token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stays disabled with an empty owner allowlist and never fetches", async () => {
    const fetchImpl = vi.fn();
    const worker = new TelegramBotWorker({
      root: makeRoot(),
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(),
      fetchImpl
    });

    const result = await worker.start();

    expect(result).toMatchObject({ enabled: false, fetched: false, reason: "missing_owner_allowlist" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("polls and replies when all opt-in gates are present", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 1,
                text: "/status",
                chat: { id: 555 },
                from: { id: 123 }
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: {
            message_id: 2,
            text: "ok",
            chat: { id: 555 }
          }
        })
      );
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl,
      getAutopilotStatus: async () => ({
        enabled: true,
        dryRun: true,
        stage: "planning",
        nextAction: "decide_next_song"
      })
    });

    const result = await worker.pollOnce();
    worker.stop();

    expect(result).toMatchObject({ enabled: true, fetched: true, processed: 1, nextOffset: 11 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain("/getUpdates");
    expect(fetchImpl.mock.calls[1][0]).toContain("/sendMessage");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string)).toMatchObject({
      text: expect.stringContaining("Stage: planning")
    });
    const state = JSON.parse(await readFile(join(root, "runtime", "telegram-state.json"), "utf8")) as { offset: number };
    expect(state.offset).toBe(11);
  });

  it("attaches latest decision buttons to /status replies", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    await ensureSongState(root, "song-ready", "Ready Song");
    await updateSongState(root, "song-ready", {
      status: "take_selected",
      selectedTakeId: "take-ready",
      replacePublicLinks: ["https://suno.com/song/take-ready"]
    });
    await registerCallbackAction(root, {
      action: "song_archive",
      songId: "song-ready",
      selectedTakeId: "take-ready",
      chatId: 555,
      messageId: 70,
      userId: 123
    });
    await registerCallbackAction(root, {
      action: "song_discard",
      songId: "song-ready",
      selectedTakeId: "take-ready",
      chatId: 555,
      messageId: 70,
      userId: 123
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: [{
          update_id: 10,
          message: {
            message_id: 1,
            text: "/status",
            chat: { id: 555 },
            from: { id: 123 }
          }
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 2, text: "status", chat: { id: 555 } } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: true }));
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.pollOnce();
    worker.stop();

    expect(result).toMatchObject({ enabled: true, fetched: true, processed: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const markup = JSON.parse(fetchImpl.mock.calls[2][1].body as string) as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["採用", "破棄"]);
    expect(markup.reply_markup.inline_keyboard.flat().every((button) => button.callback_data.startsWith("cb:"))).toBe(true);
    const pending = await listPendingCallbackActionSummaries(root, { category: "producer_decision" });
    expect(pending.recent.map((entry) => entry.action).sort()).toEqual(["song_archive", "song_discard"]);
    const allActions = await readCallbackActionEntries(root);
    expect(allActions.filter((entry) => entry.resolveReason === "superseded_by_status_decision_reissue").map((entry) => entry.action).sort()).toEqual(["song_archive", "song_discard"]);
  });

  it("attaches latest spawn proposal buttons to /status replies", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    for (const action of ["song_spawn_inject", "song_spawn_skip", "song_spawn_edit"] as const) {
      await registerCallbackAction(root, {
        action,
        songId: "spawn-ready",
        proposalId: "spawn-ready",
        chatId: 555,
        messageId: 70,
        userId: 123
      });
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: [{
          update_id: 10,
          message: {
            message_id: 1,
            text: "/status",
            chat: { id: 555 },
            from: { id: 123 }
          }
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 2, text: "status", chat: { id: 555 } } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: true }));
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.pollOnce();
    worker.stop();

    expect(result).toMatchObject({ enabled: true, fetched: true, processed: 1 });
    const markup = JSON.parse(fetchImpl.mock.calls[2][1].body as string) as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["作る", "保留する", "修正する"]);
    const pending = await listPendingCallbackActionSummaries(root, { category: "producer_decision" });
    expect(pending.recent.map((entry) => entry.action).sort()).toEqual(["song_spawn_edit", "song_spawn_inject", "song_spawn_skip"].sort());
  });

  it("announces persona setup once on the first owner message when persona is incomplete", async () => {
    const root = makeRoot();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: [
            {
              update_id: 20,
              message: {
                message_id: 1,
                text: "/status",
                chat: { id: 555 },
                from: { id: 123 }
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 2, text: "ok", chat: { id: 555 } } }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: [
            {
              update_id: 21,
              message: {
                message_id: 3,
                text: "/status",
                chat: { id: 555 },
                from: { id: 123 }
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 4, text: "ok", chat: { id: 555 } } }));
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl,
      getAutopilotStatus: async () => ({
        enabled: true,
        dryRun: true,
        stage: "planning",
        nextAction: "decide_next_song"
      })
    });

    await worker.pollOnce();
    await worker.pollOnce();

    const firstReply = JSON.parse(fetchImpl.mock.calls[1][1].body as string) as { text: string };
    const secondReply = JSON.parse(fetchImpl.mock.calls[3][1].body as string) as { text: string };
    expect(firstReply.text).toContain("Artist persona is not set up yet");
    expect(secondReply.text).not.toContain("Artist persona is not set up yet");
    const state = JSON.parse(await readFile(join(root, "runtime", "telegram-state.json"), "utf8")) as {
      offset: number;
      personaSetupAnnouncedAt: number;
    };
    expect(state.offset).toBe(22);
    expect(state.personaSetupAnnouncedAt).toBeGreaterThan(0);
  });

  it("pushes persona setup guidance on startup when a chat id is already known", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "telegram-state.json"), `${JSON.stringify({ chatId: 555 }, null, 2)}\n`, "utf8");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 1, text: "ok", chat: { id: 555 } } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: [] }));
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.start();
    worker.stop();

    expect(result).toMatchObject({ enabled: true, fetched: true, processed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain("/sendMessage");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({
      chat_id: 555,
      text: expect.stringContaining("Artist persona is not set up yet")
    });
    const state = JSON.parse(await readFile(join(root, "runtime", "telegram-state.json"), "utf8")) as {
      chatId: number;
      personaSetupAnnouncedAt: number;
    };
    expect(state.chatId).toBe(555);
    expect(state.personaSetupAnnouncedAt).toBeGreaterThan(0);
  });

  it("does not push startup guidance without a known chat id", async () => {
    const root = makeRoot();
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, result: [] }));
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.start();
    worker.stop();

    expect(result).toMatchObject({ enabled: true, fetched: true, processed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain("/getUpdates");
  });

  it("captures long-poll errors without crashing", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const worker = new TelegramBotWorker({
      root: makeRoot(),
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.pollOnce();

    expect(result).toMatchObject({ enabled: true, fetched: true, processed: 0, backoffMs: 4000, error: "network down" });
  });

  it("routes callback_query updates through the callback handler", async () => {
    const root = makeRoot();
    const entry = await registerCallbackAction(root, {
      action: "unknown_action",
      chatId: 555,
      messageId: 10,
      userId: 123
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: [
            {
              update_id: 30,
              callback_query: {
                id: "callback-1",
                from: { id: 123 },
                message: { message_id: 10, chat: { id: 555 } },
                data: `cb:${entry.callbackId}`
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: true }));
    const worker = new TelegramBotWorker({
      root,
      config: enabledConfig,
      token: "token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    const result = await worker.pollOnce();

    expect(result).toMatchObject({ enabled: true, fetched: true, processed: 1, nextOffset: 31 });
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("/getUpdates"),
      expect.stringContaining("/answerCallbackQuery"),
      expect.stringContaining("/editMessageReplyMarkup")
    ]);
  });
});
