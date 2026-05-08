import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { TelegramClient } from "../src/services/telegramClient";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import { TelegramNotifier } from "../src/services/telegramNotifier";

const originalPulse = process.env.OPENCLAW_ARTIST_PULSE_ENABLED;

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-daily-voice-e2e-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await mkdir(join(root, "observations"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: used::honda\nobsessions: 閉じる街の観察\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "tone: 率直、短く、観察ベース\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "awake\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short\n", "utf8");
  await writeFile(join(root, "observations", "2026-04-29.md"), "商店街の灯りが半分だけ消えていた。\n", "utf8");
  return root;
}

function mockSpawn(results: Array<{ code?: number | null; stdout?: string; stderr?: string }>) {
  return ((_command: string, _args: string[]) => {
    const result = results.shift() ?? { code: 0, stdout: "" };
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    process.nextTick(() => {
      if (result.stdout) {
        child.stdout.emit("data", result.stdout);
      }
      if (result.stderr) {
        child.stderr.emit("data", result.stderr);
      }
      child.emit("close", result.code ?? 0);
    });
    return child;
  }) as never;
}

function callbackClient(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

describe("telegram daily voice callback e2e", () => {
  afterEach(() => {
    if (originalPulse === undefined) {
      delete process.env.OPENCLAW_ARTIST_PULSE_ENABLED;
    } else {
      process.env.OPENCLAW_ARTIST_PULSE_ENABLED = originalPulse;
    }
    getRuntimeEventBus().clearForTest();
    vi.restoreAllMocks();
  });

  it("drafts an artist pulse, attaches buttons, publishes through bird, and audits without raw draft text", async () => {
    process.env.OPENCLAW_ARTIST_PULSE_ENABLED = "on";
    const root = await workspace();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 77, chat: { id: 123 } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: true })));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, aiReviewProvider: "mock", fetchImpl });
    const unsubscribe = notifier.subscribe(getRuntimeEventBus());

    await new ArtistAutopilotService().runCycle({
      workspaceRoot: root,
      config: { autopilot: { enabled: false, dryRun: true } },
      observationRunner: async () => ({ stdout: "商店街の灯りが半分だけ消えていた。" })
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    unsubscribe();

    const actions = await readCallbackActionEntries(root);
    const publish = actions.find((entry) => entry.action === "daily_voice_publish");
    expect(publish).toMatchObject({ messageId: 77, status: "pending", draftHash: expect.any(String), draftCharCount: expect.any(Number) });
    const editPayload = JSON.parse(String((fetchImpl.mock.calls[1]?.[1] as RequestInit).body)) as { reply_markup: { inline_keyboard: Array<Array<{ text: string }>> } };
    expect(editPayload.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["これで出す", "直す", "やめる"]);

    const client = callbackClient();
    const result = await routeTelegramCallback({
      root,
      client,
      callbackQueryId: "daily-publish",
      data: `cb:${publish?.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77,
      xPublishSpawnImpl: mockSpawn([
        { code: 0, stdout: "@used_honda" },
        { code: 0, stdout: "posted https://x.com/used_honda/status/1234567890" }
      ])
    });

    expect(result).toMatchObject({ result: "applied", reason: "daily_voice_published" });
    expect(client.editMessageText).toHaveBeenCalledWith(123, 77, expect.stringContaining("https://x.com/used_honda/status/1234567890"), { replyMarkup: { inline_keyboard: [] } });
    const audit = readFileSync(join(root, "runtime", "callback-audit.jsonl"), "utf8");
    expect(audit).toContain("daily_voice_published");
    expect(audit).not.toContain(publish?.draftText ?? "unreachable-draft");
  });
});
