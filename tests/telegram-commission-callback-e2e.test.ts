import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { readAutopilotRunState } from "../src/services/autopilotService";
import { readConversationalSession } from "../src/services/conversationalSession";
import { routeTelegramCallback } from "../src/services/telegramCallbackHandler";
import { routeTelegramCommand } from "../src/services/telegramCommandRouter";
import type { TelegramClient } from "../src/services/telegramClient";

const originalCommission = process.env.OPENCLAW_COMMISSION_ENABLED;

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-commission-e2e-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: used::honda\n", "utf8");
  await writeFile(join(root, "SOUL.md"), "Mood: blunt\n", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "state\n", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "voice\n", "utf8");
  await writeFile(join(root, "artist", "SONGBOOK.md"), "# SONGBOOK.md\n", "utf8");
  return root;
}

function client(): TelegramClient {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 77, chat: { id: 2 } })
  } as unknown as TelegramClient;
}

describe("telegram commission callback e2e", () => {
  afterEach(() => {
    if (originalCommission === undefined) {
      delete process.env.OPENCLAW_COMMISSION_ENABLED;
    } else {
      process.env.OPENCLAW_COMMISSION_ENABLED = originalCommission;
    }
    vi.restoreAllMocks();
  });

  it("previews a commission ChangeSet and injects it into autopilot planning from Yes callback", async () => {
    process.env.OPENCLAW_COMMISSION_ENABLED = "on";
    const root = await workspace();

    const proposed = await routeTelegramCommand({
      text: "/commission 都市の境界線で見えなくなる音、4 分くらい、太い bass + jazz drum",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });
    const proposalId = proposed.proposalButtons?.proposalId;
    const sessionProposal = (await readConversationalSession(root, 2, 1))?.pendingChangeSet;
    expect(proposed.responseText).toContain("曲作りに進める");
    expect(sessionProposal?.source).toBe("commission");
    expect(sessionProposal?.commissionBrief?.songId).toMatch(/^commission_/);

    const entry = await registerCallbackAction(root, {
      action: "proposal_yes",
      proposalId,
      chatId: 2,
      messageId: 50,
      userId: 1
    });
    const result = await routeTelegramCallback({
      root,
      client: client(),
      callbackQueryId: "commission-yes",
      data: `cb:${entry.callbackId}`,
      fromUserId: 1,
      chatId: 2,
      messageId: 50
    });
    const songId = sessionProposal?.commissionBrief?.songId ?? "";
    const state = await readAutopilotRunState(root);

    expect(result).toMatchObject({ result: "applied", reason: "applied" });
    expect(state).toMatchObject({ currentSongId: songId, stage: "planning" });
    expect(readFileSync(join(root, "songs", songId, "brief.md"), "utf8")).toContain("Producer commission");
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toContain(`| ${songId} |`);
    expect((await readConversationalSession(root, 2, 1))?.pendingChangeSet).toBeUndefined();
  });

  it("keeps commission disabled by default", async () => {
    delete process.env.OPENCLAW_COMMISSION_ENABLED;
    const root = await workspace();

    const proposed = await routeTelegramCommand({
      text: "/commission 何か作って",
      fromUserId: 1,
      chatId: 2,
      workspaceRoot: root
    });

    expect(proposed.responseText).toContain("commission intake is disabled");
    expect(proposed.proposalButtons).toBeUndefined();
  });
});
