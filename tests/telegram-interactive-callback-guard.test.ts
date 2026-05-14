import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { handleTelegramInteractiveCallback } from "../src/services/telegramInteractiveCallbackGuard";

function root(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-interactive-callback-"));
}

async function auditLines(workspace: string): Promise<Array<Record<string, unknown>>> {
  const contents = await readFile(join(workspace, "runtime", "callback-audit.jsonl"), "utf8");
  return contents.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("telegram interactive callback guard", () => {
  const originalWorkspace = process.env.OPENCLAW_LOCAL_WORKSPACE;

  afterEach(() => {
    if (originalWorkspace === undefined) {
      delete process.env.OPENCLAW_LOCAL_WORKSPACE;
    } else {
      process.env.OPENCLAW_LOCAL_WORKSPACE = originalWorkspace;
    }
  });

  it("handles stale cb payloads before OpenClaw can synthesize them as agent messages", async () => {
    const workspace = root();
    process.env.OPENCLAW_LOCAL_WORKSPACE = workspace;
    const respond = {
      reply: vi.fn(),
      editMessage: vi.fn(),
      editButtons: vi.fn(),
      clearButtons: vi.fn()
    };

    const result = await handleTelegramInteractiveCallback({
      callbackId: "telegram-query-1",
      senderId: "300",
      callback: {
        data: "cb:missing",
        payload: "missing",
        chatId: "100",
        messageId: 200
      },
      respond
    });

    expect(result).toEqual({ handled: true });
    expect(respond.reply).not.toHaveBeenCalled();
    expect(respond.editMessage).not.toHaveBeenCalled();
    expect(respond.editButtons).not.toHaveBeenCalled();
    expect(respond.clearButtons).not.toHaveBeenCalled();
    expect(await auditLines(workspace)).toEqual([
      expect.objectContaining({
        callbackId: "missing",
        result: "expired",
        reason: "unknown_callback_blocked",
        actor: "telegram_callback"
      })
    ]);
  });

  it("routes known callbacks through the existing handler and still consumes the core callback", async () => {
    const workspace = root();
    process.env.OPENCLAW_LOCAL_WORKSPACE = workspace;
    const entry = await registerCallbackAction(workspace, {
      action: "unknown_action",
      chatId: 100,
      messageId: 200,
      userId: 300
    });
    const respond = {
      reply: vi.fn(),
      editMessage: vi.fn(),
      editButtons: vi.fn(),
      clearButtons: vi.fn()
    };

    const result = await handleTelegramInteractiveCallback({
      callbackId: "telegram-query-2",
      senderId: "300",
      callback: {
        data: `cb:${entry.callbackId}`,
        payload: entry.callbackId,
        chatId: "100",
        messageId: 200
      },
      respond
    });

    expect(result).toEqual({ handled: true });
    expect(respond.editButtons).toHaveBeenCalledWith({ buttons: [] });
    expect(await auditLines(workspace)).toEqual([
      expect.objectContaining({
        callbackId: entry.callbackId,
        action: "unknown_action",
        result: "failed",
        reason: "unsupported_action"
      })
    ]);
  });

  it("does not claim non-cb interactive payloads", async () => {
    await expect(handleTelegramInteractiveCallback({
      callback: { data: "commands_page_1", payload: "" }
    })).resolves.toEqual({ handled: false });
  });
});
