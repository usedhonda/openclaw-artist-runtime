import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { startTelegramNotifierFromEnv, stopTelegramNotifierSubscriptions } from "../src/services";

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-notifier-wireup-"));
}

function telegramFetch() {
  return vi.fn(async (input: string) => ({
    ok: true,
    json: async () => ({
      ok: true,
      result: String(input).includes("/sendMessage")
        ? { message_id: 1001, chat: { id: 123 }, date: 0, text: "ok" }
        : true
    })
  })) as unknown as typeof fetch;
}

function env(workspaceRoot: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    OPENCLAW_LOCAL_WORKSPACE: workspaceRoot,
    TELEGRAM_BOT_TOKEN: "mock-token",
    TELEGRAM_OWNER_USER_IDS: "123",
    ...extra
  } as NodeJS.ProcessEnv;
}

describe("telegram notifier service wireup", () => {
  afterEach(() => {
    stopTelegramNotifierSubscriptions();
    getRuntimeEventBus().clearForTest();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("subscribes TelegramNotifier and forwards artist pulse drafts", async () => {
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const workspaceRoot = root();

    await expect(startTelegramNotifierFromEnv(env(workspaceRoot))).resolves.toEqual({ started: 1 });
    getRuntimeEventBus().emit({
      type: "artist_pulse_drafted",
      voiceKind: "musing",
      draftText: "街の端で低いベースだけ残ってる。",
      draftHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      charCount: 18,
      sourceFragments: ["observation"],
      createdAt: "2026-04-30T00:00:00.000Z",
      timestamp: Date.now()
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/sendMessage"), expect.any(Object)));
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)).text).toContain("💭 つぶやき draft");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/editMessageReplyMarkup"), expect.any(Object)));
  });

  it("forwards song spawn proposals to Telegram", async () => {
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);
    const workspaceRoot = root();

    await startTelegramNotifierFromEnv(env(workspaceRoot));
    getRuntimeEventBus().emit({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_test",
      voiceTop: "ゆずる、次の曲の火種を見た。",
      reason: "observations have signal",
      brief: {
        songId: "spawn_test",
        title: "境界の音",
        brief: "境界の音",
        mood: "observational",
        tempo: "128 BPM",
        duration: "4 min",
        styleNotes: "thick bass",
        lyricsTheme: "city edge",
        sourceText: "autopilot spawn",
        createdAt: "2026-04-30T00:00:00.000Z"
      },
      timestamp: Date.now()
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/sendMessage"), expect.any(Object)));
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)).text).toContain("境界の音");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/editMessageReplyMarkup"), expect.any(Object)));
  });

  it("skips gracefully when token or chat id is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(startTelegramNotifierFromEnv(env(root(), { TELEGRAM_BOT_TOKEN: undefined }))).resolves.toMatchObject({ started: 0 });
    expect(warn).toHaveBeenCalledWith("[artist-runtime] telegram notifier disabled: token/chatId missing");
  });

  it("skips when OPENCLAW_TELEGRAM_NOTIFIER is off", async () => {
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(startTelegramNotifierFromEnv(env(root(), { OPENCLAW_TELEGRAM_NOTIFIER: "off" }))).resolves.toEqual({
      started: 0,
      reason: "disabled_by_flag"
    });
    getRuntimeEventBus().emit({
      type: "artist_pulse_drafted",
      voiceKind: "musing",
      draftText: "off",
      draftHash: "hash",
      charCount: 3,
      sourceFragments: [],
      createdAt: "2026-04-30T00:00:00.000Z",
      timestamp: Date.now()
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
