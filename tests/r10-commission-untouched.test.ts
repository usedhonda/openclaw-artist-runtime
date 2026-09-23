import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { createConversationalSession } from "../src/services/conversationalSession";
import { readResolvedConfig } from "../src/services/runtimeConfig";
import { handleCommission } from "../src/services/songCommissionHandler";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import type { TelegramClient } from "../src/services/telegramClient";

const originalCommission = process.env.OPENCLAW_COMMISSION_ENABLED;

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1, chat: { id: 123 } })
  } as unknown as TelegramClient;
}

describe("R10 commission injection boundary", () => {
  afterEach(() => {
    if (originalCommission === undefined) {
      delete process.env.OPENCLAW_COMMISSION_ENABLED;
    } else {
      process.env.OPENCLAW_COMMISSION_ENABLED = originalCommission;
    }
    vi.restoreAllMocks();
  });

  it("injects a commission without changing dry-run or live arm flags", async () => {
    process.env.OPENCLAW_COMMISSION_ENABLED = "on";
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-commission-"));
    const before = await readResolvedConfig(root);
    const commission = await handleCommission(root, { brief: "ライブハウスが消える街の曲、太い bass" });
    await createConversationalSession(root, {
      chatId: 123,
      userId: 123,
      topic: { kind: "song", songId: commission.commissionBrief.songId },
      pendingChangeSet: commission.proposal
    });
    const entry = await registerCallbackAction(root, {
      action: "proposal_yes",
      proposalId: commission.proposal.id,
      chatId: 123,
      messageId: 77,
      userId: 123
    });

    const result = await routeTelegramCallback({
      root,
      client: client(),
      callbackQueryId: "commission-r10",
      data: `cb:${entry.callbackId}`,
      fromUserId: 123,
      chatId: 123,
      messageId: 77
    });
    const after = await readResolvedConfig(root);

    expect(result).toMatchObject({ result: "applied" });
    expect(after.autopilot.dryRun).toBe(before.autopilot.dryRun);
    expect(after.autopilot.dryRun).toBe(true);
    expect(after.distribution.liveGoArmed).toBe(before.distribution.liveGoArmed);
    expect(after.distribution.platforms.x.liveGoArmed).toBe(before.distribution.platforms.x.liveGoArmed);
    expect(after.distribution.platforms.instagram.liveGoArmed).toBe(before.distribution.platforms.instagram.liveGoArmed);
    expect(after.distribution.platforms.tiktok.liveGoArmed).toBe(before.distribution.platforms.tiktok.liveGoArmed);
  });
});
