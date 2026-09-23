import { access, readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TelegramBotWorker } from "../src/services/telegramBotWorker";
import { classifyTelegramFreeText, readTelegramInbox } from "../src/services/telegramCommandRouter";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-telegram-inbox-"));
}

describe("Telegram free-text inbox", () => {
  it("stores owner free-text locally with rule-based intent classification", async () => {
    const root = makeRoot();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [{
            update_id: 21,
            message: { message_id: 1, chat: { id: 99 }, from: { id: 123 }, text: "please pause after this cycle" }
          }]
        }));
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }));
    });

    const worker = new TelegramBotWorker({
      root,
      config: { enabled: true, pollIntervalMs: 1000, notifyStages: true, acceptFreeText: true },
      token: "mock-token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    await worker.pollOnce();
    const inbox = await readTelegramInbox(root);
    const raw = await readFile(join(root, "runtime", "telegram-inbox.jsonl"), "utf8");

    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      type: "free_text",
      intent: "pause",
      text: "please pause after this cycle"
    });
    expect(raw).not.toMatch(/mock-token|TELEGRAM_BOT_TOKEN/i);
  });

  it("classifies lightweight free-text intents without external calls", () => {
    expect(classifyTelegramFreeText("status please")).toBe("status");
    expect(classifyTelegramFreeText("resume the artist")).toBe("resume");
    expect(classifyTelegramFreeText("write about a dead mall")).toBe("artist_inbox");
  });

  it("does not store owner free-text when acceptFreeText is disabled", async () => {
    const root = makeRoot();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [{
            update_id: 22,
            message: { message_id: 1, chat: { id: 99 }, from: { id: 123 }, text: "write about a dead mall" }
          }]
        }));
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }));
    });

    const worker = new TelegramBotWorker({
      root,
      config: { enabled: true, pollIntervalMs: 1000, notifyStages: true, acceptFreeText: false },
      token: "mock-token",
      ownerUserIds: new Set(["123"]),
      fetchImpl
    });

    await worker.pollOnce();

    await expect(access(join(root, "runtime", "telegram-inbox.jsonl"))).rejects.toThrow();
    const reply = JSON.parse(fetchImpl.mock.calls[1][1].body as string) as { text: string };
    expect(reply.text).toContain("Free text intake is disabled");
  });
});
