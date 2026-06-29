import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SpawnProposal, TelegramConfig } from "../src/types";
import { TelegramBotWorker } from "../src/services/telegramBotWorker";
import { listPendingCallbackActionSummaries, readCallbackActionEntries, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { ensureSongState, readSongState, updateSongState, writeSongBrief } from "../src/services/artistState";
import { appendSpawnProposal } from "../src/services/spawnProposalQueue";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";

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

function callbackClient(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 10, chat: { id: 555 } })
  } as unknown as TelegramClient;
}

function spawnProposal(songId = "spawn-status"): SpawnProposal {
  return {
    proposalId: songId,
    createdAt: "2026-06-20T00:00:00.000Z",
    status: "draft",
    title: "Status Draft",
    voiceTop: "この草稿で作る。",
    coreTheme: "Telegramだけで戻れる草稿",
    observationSources: [
      { kind: "news", label: "fixture", quote: "draft source", url: "https://example.com/draft" }
    ],
    cascadeTrace: {
      observationSources: [
        { kind: "news", label: "fixture", quote: "draft source", url: "https://example.com/draft" }
      ],
      artistVoice: "この草稿で作る。",
      title: "Status Draft",
      lyricsTheme: "Telegramだけで戻れる草稿",
      styleLayer: "fast noisy pop, dry vocal"
    }
  };
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

  it("recreates URL-ready adoption buttons on /status when callback rows are missing", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    await ensureSongState(root, "song-url", "URL Ready Song");
    await updateSongState(root, "song-url", {
      status: "suno_take_url_ready",
      selectedTakeId: "take-url",
      appendPublicLinks: ["https://suno.com/song/take-url"]
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
    const statusBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string) as { text: string };
    expect(statusBody.text).toContain("Suno URL 採用待ち");
    const markup = JSON.parse(fetchImpl.mock.calls[2][1].body as string) as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["採用して音源取得", "破棄"]);
    expect(markup.reply_markup.inline_keyboard.flat().every((button) => button.callback_data.startsWith("cb:"))).toBe(true);
    const pending = await listPendingCallbackActionSummaries(root, { category: "producer_decision" });
    expect(pending.recent.map((entry) => entry.action).sort()).toEqual(["song_archive", "song_discard"]);
  });

  it("recreates selected-take adoption buttons on /status when callback rows are missing", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    await ensureSongState(root, "song-selected", "Selected Song");
    await updateSongState(root, "song-selected", {
      status: "take_selected",
      selectedTakeId: "take-selected",
      replacePublicLinks: ["https://suno.com/song/take-selected"]
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
    const statusBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string) as { text: string };
    expect(statusBody.text).toContain("完成曲採用待ち");
    const markup = JSON.parse(fetchImpl.mock.calls[2][1].body as string) as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["採用", "破棄"]);
    const pending = await listPendingCallbackActionSummaries(root, { category: "producer_decision" });
    expect(pending.recent.map((entry) => entry.action).sort()).toEqual(["song_archive", "song_discard"]);
  });

  it("recreates prompt-pack GO buttons on /status and the GO callback advances to Suno", async () => {
    const root = makeRoot();
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "runtime"), { recursive: true });
    await ensureSongState(root, "song-prompt", "Prompt Ready Song");
    await updateSongState(root, "song-prompt", { status: "suno_prompt_pack" });
    await writeAutopilotRunState(root, {
      runId: "prompt-ready",
      currentSongId: "song-prompt",
      stage: "prompt_pack",
      suspendedAt: "prompt_pack_ready",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: new Date().toISOString()
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
    const statusBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string) as { text: string };
    expect(statusBody.text).toContain("Suno 生成GO待ち");
    const markup = JSON.parse(fetchImpl.mock.calls[2][1].body as string) as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["Suno 生成へ", "lyrics-suno.md を編集", "保留"]);
    const go = (await readCallbackActionEntries(root)).find((entry) => entry.action === "prompt_pack_go" && entry.songId === "song-prompt");
    expect(go).toMatchObject({ status: "pending", songId: "song-prompt" });

    await expect(routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "prompt-go-restored",
      data: `cb:${go?.callbackId}`,
      fromUserId: 123,
      chatId: 555,
      messageId: 2
    })).resolves.toMatchObject({ result: "applied", reason: "prompt_pack_go" });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "suno_generation", suspendedAt: null });
  });

  it("recreates degraded-lyrics recovery buttons on /status and redraft clears the stop", async () => {
    const root = makeRoot();
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "runtime"), { recursive: true });
    await ensureSongState(root, "song-lyrics", "Lyrics Stuck");
    await updateSongState(root, "song-lyrics", {
      status: "brief",
      degradedLyrics: true,
      reason: "lyrics_generation_degraded: provider fallback response"
    });
    await writeAutopilotRunState(root, {
      runId: "lyrics-degraded",
      currentSongId: "song-lyrics",
      stage: "paused",
      paused: true,
      blockedReason: "lyrics_generation_degraded: provider fallback response",
      retryCount: 1,
      cycleCount: 1,
      updatedAt: new Date().toISOString()
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
    const statusBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string) as { text: string };
    expect(statusBody.text).toContain("歌詞生成停止");
    const markup = JSON.parse(fetchImpl.mock.calls[2][1].body as string) as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["歌詞を作り直す", "破棄"]);
    const redraft = (await readCallbackActionEntries(root)).find((entry) => entry.action === "lyrics_redraft" && entry.songId === "song-lyrics");
    expect(redraft).toMatchObject({ status: "pending", songId: "song-lyrics" });

    await expect(routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "lyrics-redraft-restored",
      data: `cb:${redraft?.callbackId}`,
      fromUserId: 123,
      chatId: 555,
      messageId: 2
    })).resolves.toMatchObject({ result: "updated", reason: "lyrics_redraft_requested" });
    expect(await readSongState(root, "song-lyrics")).toMatchObject({ status: "brief", degradedLyrics: false });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "planning", paused: false, suspendedAt: null });
  });

  it("recreates planning skeleton buttons on /status and apply advances to prompt pack", async () => {
    const root = makeRoot();
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "runtime"), { recursive: true });
    await ensureSongState(root, "song-plan", "Planning Stuck");
    await writeSongBrief(root, "song-plan", "# Brief\n\n- Mood: cold");
    await writeAutopilotRunState(root, {
      runId: "planning-pending",
      currentSongId: "song-plan",
      stage: "planning",
      suspendedAt: "planning_skeleton_pending",
      blockedReason: "planning_skeleton_incomplete:tempo,duration,style notes",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      updatedAt: new Date().toISOString()
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
    const statusBody = JSON.parse(fetchImpl.mock.calls[1][1].body as string) as { text: string };
    expect(statusBody.text).toContain("Planning補完待ち");
    const markup = JSON.parse(fetchImpl.mock.calls[2][1].body as string) as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    };
    expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["進める", "中止", "書き直す"]);
    const apply = (await readCallbackActionEntries(root)).find((entry) => entry.action === "planning_skeleton_apply" && entry.songId === "song-plan");
    expect(apply).toMatchObject({ status: "pending", songId: "song-plan", proposalId: expect.stringMatching(/^planning-song-plan-/) });

    await expect(routeTelegramCallback({
      root,
      client: callbackClient(),
      callbackQueryId: "planning-apply-restored",
      data: `cb:${apply?.callbackId}`,
      fromUserId: 123,
      chatId: 555,
      messageId: 2
    })).resolves.toMatchObject({ result: "applied", reason: "applied" });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "prompt_pack", suspendedAt: null });
    await expect(readFile(join(root, "songs", "song-plan", "brief.md"), "utf8")).resolves.toContain("Planning Completion");
  });

  it("attaches latest spawn proposal buttons to /status replies", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    await appendSpawnProposal(root, spawnProposal("spawn-ready"));
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
    const entries = await readCallbackActionEntries(root);
    expect(entries.findLast((entry) => entry.action === "song_spawn_inject" && entry.songId === "spawn-ready" && entry.status === "pending")?.commissionBrief).toMatchObject({
      songId: "spawn-ready",
      title: "Status Draft"
    });
  });

  it("recreates draft-box spawn buttons on /status with usable commission briefs", async () => {
    const originalSpawn = process.env.OPENCLAW_SONG_SPAWN_ENABLED;
    process.env.OPENCLAW_SONG_SPAWN_ENABLED = "on";
    const root = makeRoot();
    try {
      await ensureArtistWorkspace(root);
      await mkdir(join(root, "runtime"), { recursive: true });
      await appendSpawnProposal(root, spawnProposal());
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

      const poll = await worker.pollOnce();
      worker.stop();

      expect(poll).toMatchObject({ enabled: true, fetched: true, processed: 1 });
      const markup = JSON.parse(fetchImpl.mock.calls[2][1].body as string) as {
        reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
      };
      expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["作る", "保留する", "修正する"]);
      const entries = await readCallbackActionEntries(root);
      const inject = entries.find((entry) => entry.action === "song_spawn_inject" && entry.songId === "spawn-status");
      expect(inject?.commissionBrief).toMatchObject({
        songId: "spawn-status",
        title: "Status Draft",
        lyricsTheme: "Telegramだけで戻れる草稿"
      });

      const applied = await routeTelegramCallback({
        root,
        client: callbackClient(),
        callbackQueryId: "inject-restored",
        data: `cb:${inject?.callbackId}`,
        fromUserId: 123,
        chatId: 555,
        messageId: 2
      });

      expect(applied).toMatchObject({ result: "applied", reason: "song_spawn_injected" });
      expect(await readSongState(root, "spawn-status")).toMatchObject({ status: "brief", title: "Status Draft" });
    } finally {
      if (originalSpawn === undefined) {
        delete process.env.OPENCLAW_SONG_SPAWN_ENABLED;
      } else {
        process.env.OPENCLAW_SONG_SPAWN_ENABLED = originalSpawn;
      }
    }
  });

  it("attaches latest proposal confirmation buttons to /status replies", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });
    for (const action of ["proposal_yes", "proposal_no", "proposal_edit_open"] as const) {
      await registerCallbackAction(root, {
        action,
        proposalId: "commission-ready",
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
    expect(markup.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["Yes", "No", "Edit"]);
    const pending = await listPendingCallbackActionSummaries(root, { category: "working_confirmation" });
    expect(pending.recent.filter((entry) => entry.proposalId === "commission-ready" && entry.messageId === 2).map((entry) => entry.action).sort()).toEqual(["proposal_edit_open", "proposal_no", "proposal_yes"].sort());
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
