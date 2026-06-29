import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { writeAutopilotRunState } from "../src/services/autopilotService";
import { registerCallbackAction } from "../src/services/callbackActionRegistry";
import { composeProducerStatus } from "../src/services/producerStatusComposer";
import { isProducerStatusIntent, routeTelegramCommand } from "../src/services/telegramCommandRouter";

async function root(): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "artist-runtime-producer-status-"));
  await ensureArtistWorkspace(workspaceRoot);
  return workspaceRoot;
}

describe("producer status composer", () => {
  it("keeps idle /status concise with one next action and no internal callback wording", async () => {
    const workspaceRoot = await root();
    await writeAutopilotRunState(workspaceRoot, {
      runId: "run-status",
      stage: "planning",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      blockedReason: "song_spawn_waiting_for_proposal",
      updatedAt: new Date(0).toISOString()
    });

    const text = await composeProducerStatus(workspaceRoot, { now: Date.parse("2026-05-26T00:00:00.000Z") });

    expect(text.match(/^現在地:/gm)).toHaveLength(1);
    expect(text.match(/^次:/gm)).toHaveLength(1);
    expect(text).toContain("実行状態:");
    expect(text).toContain("- 操作待ち: なし");
    expect(text).not.toContain("callback");
  });

  it("summarizes current song, blocked state, public url, and producer decision effects", async () => {
    const workspaceRoot = await root();
    const now = Date.parse("2026-05-26T00:00:00.000Z");
    await ensureSongState(workspaceRoot, "song-026", "みじかいかげ");
    await updateSongState(workspaceRoot, "song-026", {
      status: "take_selected",
      selectedTakeId: "take-1",
      replacePublicLinks: ["https://suno.com/song/take-1"],
      reason: "test"
    });
    await writeAutopilotRunState(workspaceRoot, {
      runId: "run-status",
      currentSongId: "song-026",
      stage: "take_selection",
      suspendedAt: "producer_decision",
      blockedReason: "waiting_for_song_archive_or_discard",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      updatedAt: new Date(now).toISOString(),
      lastRunAt: new Date(now).toISOString()
    });
    await registerCallbackAction(workspaceRoot, {
      action: "song_archive",
      songId: "song-026",
      chatId: 1,
      messageId: 2,
      userId: 1,
      now: now - 9 * 60 * 60 * 1000
    });

    const text = await composeProducerStatus(workspaceRoot, {
      now,
      dashboardBaseUrl: "http://127.0.0.1:8787"
    });

    expect(text).toContain("Stage: take_selection");
    expect(text).toContain("草稿箱: draft 0件 / building 0件");
    expect(text).toContain("次:");
    expect(text).toContain("song-026 / みじかいかげ");
    expect(text).toContain("採用");
    expect(text).toContain("9時間前");
    expect(text).toContain("https://suno.com/song/take-1");
    expect(text).toContain("http://127.0.0.1:8787/plugins/artist-runtime#song=song-026");
  });

  it("shows only the latest Telegram decision notice and folds older pending decisions", async () => {
    const workspaceRoot = await root();
    const now = Date.parse("2026-05-26T00:00:00.000Z");
    await ensureSongState(workspaceRoot, "old-song", "古い曲");
    await updateSongState(workspaceRoot, "old-song", {
      status: "take_selected",
      replacePublicLinks: ["https://suno.com/song/old"]
    });
    await ensureSongState(workspaceRoot, "new-song", "新しい曲");
    await updateSongState(workspaceRoot, "new-song", {
      status: "take_selected",
      replacePublicLinks: ["https://suno.com/song/new"]
    });
    await registerCallbackAction(workspaceRoot, {
      action: "song_archive",
      songId: "old-song",
      chatId: 1,
      messageId: 10,
      userId: 1,
      now: now - 60_000
    });
    await registerCallbackAction(workspaceRoot, {
      action: "song_discard",
      songId: "old-song",
      chatId: 1,
      messageId: 10,
      userId: 1,
      now: now - 60_000
    });
    await registerCallbackAction(workspaceRoot, {
      action: "song_archive",
      songId: "new-song",
      chatId: 1,
      messageId: 11,
      userId: 1,
      now
    });
    await registerCallbackAction(workspaceRoot, {
      action: "song_discard",
      songId: "new-song",
      chatId: 1,
      messageId: 11,
      userId: 1,
      now
    });

    const text = await composeProducerStatus(workspaceRoot, { now });

    expect(text).toContain("最新の待ち: new-song / 新しい曲");
    expect(text).toContain("ボタン: 採用 / 破棄");
    expect(text).toContain("URL: https://suno.com/song/new");
    expect(text).toContain("古い待ち: 折りたたみ");
    expect(text).not.toContain("2件");
    expect(text).not.toContain("最新の待ち: old-song");
  });

  it("shows pending proposal confirmation when no producer decision is pending", async () => {
    const workspaceRoot = await root();
    const now = Date.parse("2026-05-26T00:00:00.000Z");
    for (const action of ["proposal_yes", "proposal_no", "proposal_edit_open"] as const) {
      await registerCallbackAction(workspaceRoot, {
        action,
        proposalId: "commission-next",
        chatId: 1,
        messageId: 12,
        userId: 1,
        now
      });
    }

    const text = await composeProducerStatus(workspaceRoot, { now });

    expect(text).toContain("最新の待ち: commission-next");
    expect(text).toContain("ボタン: 反映 / 保留 / 編集");
    expect(text).toContain("次: この /status 返信のボタンで");
  });

  it("points empty status at the always-available song create command", async () => {
    const workspaceRoot = await root();
    const text = await composeProducerStatus(workspaceRoot);

    expect(text).toContain("次: 作りたい曲があるなら /song create <方向性> を送る。");
    expect(text).not.toContain("急ぐなら /commission");
  });

  it("routes free-text status intent before the conversational router", async () => {
    const workspaceRoot = await root();
    await writeAutopilotRunState(workspaceRoot, {
      runId: "run-status",
      stage: "planning",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      updatedAt: new Date(0).toISOString()
    });

    expect(isProducerStatusIntent("いま?")).toBe(true);
    const result = await routeTelegramCommand({
      text: "いま?",
      fromUserId: 1,
      chatId: 1,
      workspaceRoot
    });

    expect(result.kind).toBe("status");
    expect(result.shouldStoreFreeText).toBe(false);
    expect(result.responseText).toContain("現在地:");
    expect(result.responseText).toContain("実行状態:");
  });
});
