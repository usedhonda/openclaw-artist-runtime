import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
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

async function click(root: string, callbackId: string) {
  return routeTelegramCallback({
    root,
    client: client(),
    callbackQueryId: "prompt-pack",
    data: `cb:${callbackId}`,
    fromUserId: 123,
    chatId: 123,
    messageId: 77
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
});
