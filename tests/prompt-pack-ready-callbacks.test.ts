import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { readCallbackActionEntries, registerCallbackAction } from "../src/services/callbackActionRegistry";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import type { TelegramClient } from "../src/services/telegramClient";
import { TelegramNotifier } from "../src/services/telegramNotifier";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 77, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

async function seed(action: "prompt_pack_go" | "prompt_pack_edit" | "prompt_pack_skip"): Promise<{ root: string; callbackId: string }> {
  const root = mkdtempSync(join(tmpdir(), `artist-runtime-${action}-`));
  await ensureArtistWorkspace(root);
  await ensureSongState(root, "song-ready", "Song Ready");
  await updateSongState(root, "song-ready", { status: "suno_prompt_pack" });
  await writeAutopilotRunState(root, {
    runId: "prompt-ready",
    currentSongId: "song-ready",
    stage: "prompt_pack",
    suspendedAt: "prompt_pack_ready",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    lastSuccessfulStage: "prompt_pack"
  });
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
    .mockResolvedValueOnce(telegramResponse(true));
  await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl }).notify({
    type: "prompt_pack_ready",
    songId: "song-ready",
    title: "Song Ready",
    lyricsExcerpt: "一行目\n二行目\n三行目",
    mood: "cold",
    tempo: "128 BPM",
    styleNotes: "thick bass",
    voiceTop: "ゆずるさん、歌詞こんな感じ。Suno 行く?",
    timestamp: 1
  });
  const entry = (await readCallbackActionEntries(root)).find((item) => item.action === action);
  return { root, callbackId: entry?.callbackId ?? "" };
}

async function click(root: string, callbackId: string, messageId = 77) {
  return routeTelegramCallback({
    root,
    client: client(),
    callbackQueryId: "prompt-pack",
    data: `cb:${callbackId}`,
    fromUserId: 123,
    chatId: 123,
    messageId
  });
}

describe("prompt_pack_ready callbacks", () => {
  it("resumes into Suno generation when producer taps go", async () => {
    const { root, callbackId } = await seed("prompt_pack_go");

    await expect(click(root, callbackId)).resolves.toMatchObject({ result: "applied", reason: "prompt_pack_go" });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "suno_generation", suspendedAt: null });
  });

  it("returns to planning and reopens lyrics generation when producer taps edit", async () => {
    const { root, callbackId } = await seed("prompt_pack_edit");

    await expect(click(root, callbackId)).resolves.toMatchObject({ result: "updated", reason: "prompt_pack_edit" });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "planning", suspendedAt: null });
    expect((await readSongState(root, "song-ready")).status).toBe("brief");
  });

  it("keeps the prompt pack paused when producer taps later", async () => {
    const { root, callbackId } = await seed("prompt_pack_skip");

    await expect(click(root, callbackId)).resolves.toMatchObject({ result: "discarded", reason: "prompt_pack_skip" });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "prompt_pack", suspendedAt: "user_paused" });
  });

  it("re-surfaces an expired Suno GO button from /resume and the fresh button advances to suno_generation", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-prompt-pack-resume-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "song-ready", "Song Ready");
    await updateSongState(root, "song-ready", { status: "suno_prompt_pack", lyricsVersion: 1 });
    await mkdir(join(root, "songs", "song-ready", "lyrics"), { recursive: true });
    await mkdir(join(root, "songs", "song-ready", "suno"), { recursive: true });
    await writeFile(join(root, "songs", "song-ready", "lyrics", "lyrics.v1.md"), "一行目\n二行目\n三行目\n", "utf8");
    await writeFile(join(root, "songs", "song-ready", "mood-hint.txt"), "cold", "utf8");
    await writeFile(join(root, "songs", "song-ready", "suno", "style.md"), "nu-jazz, male vocal, 128 BPM, thick bass", "utf8");
    await writeAutopilotRunState(root, {
      runId: "prompt-ready",
      currentSongId: "song-ready",
      stage: "prompt_pack",
      suspendedAt: "prompt_pack_ready",
      paused: true,
      retryCount: 0,
      cycleCount: 0,
      updatedAt: new Date(9000).toISOString(),
      lastRunAt: new Date(9000).toISOString(),
      lastSuccessfulStage: "prompt_pack"
    });
    await registerCallbackAction(root, {
      action: "prompt_pack_go",
      songId: "song-ready",
      chatId: 123,
      messageId: 76,
      userId: 123,
      now: 1000,
      expiresAt: 2000
    });

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 88, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });
    const delivered = new Promise<void>((resolve, reject) => {
      const unsubscribe = getRuntimeEventBus().subscribe((event) => {
        if (event.type !== "prompt_pack_ready") return;
        void notifier.notify(event).then(() => {
          unsubscribe();
          resolve();
        }).catch((error) => {
          unsubscribe();
          reject(error);
        });
      });
    });

    const route = await routeTelegramCommand({
      text: "/resume",
      fromUserId: 123,
      chatId: 123,
      workspaceRoot: root
    });
    await delivered;

    expect(route.kind).toBe("resume");
    expect(route.responseText).toContain("再表示");
    const freshGo = (await readCallbackActionEntries(root))
      .filter((entry) => entry.action === "prompt_pack_go" && entry.messageId === 88)
      .at(-1);
    expect(freshGo).toMatchObject({ status: "pending", songId: "song-ready" });
    expect((freshGo?.expiresAt ?? 0) - (freshGo?.createdAt ?? 0)).toBe(30 * 24 * 60 * 60 * 1000);

    await expect(click(root, freshGo?.callbackId ?? "", 88)).resolves.toMatchObject({ result: "applied", reason: "prompt_pack_go" });
    expect(await readAutopilotRunState(root)).toMatchObject({ stage: "suno_generation", suspendedAt: null });
  });
});
