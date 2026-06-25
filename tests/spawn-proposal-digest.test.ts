import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildSpawnProposalsResponse } from "../src/routes";
import { describeCallbackActionEffect, readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { appendSpawnProposal, clearSpawnProposalQueueCacheForTest } from "../src/services/spawnProposalQueue";
import { TelegramNotifier } from "../src/services/telegramNotifier";
import type { CommissionBrief, SpawnProposal } from "../src/types";
import { SpawnProposalQueuePanel } from "../ui/src/components/SpawnProposalQueuePanel";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-spawn-proposal-digest-"));
}

function brief(songId: string, title: string, theme: string): CommissionBrief {
  return {
    songId,
    title,
    brief: `${theme}を曲にする。`,
    lyricsTheme: `${theme}をヴァースで景色にして、サビで短く畳む。`,
    mood: "tense",
    tempo: "142 BPM",
    duration: "2:45",
    styleNotes: "thick bass, restrained hi-hats, dry male vocal",
    sourceText: "test",
    createdAt: "2026-05-28T00:00:00.000Z",
    sources: [
      { kind: "news", url: "https://example.com/news", author: "desk", quote: `${theme}のニュース` }
    ]
  };
}

function event(songId: string, title: string, theme: string) {
  return {
    type: "song_spawn_proposed" as const,
    candidateSongId: songId,
    brief: brief(songId, title, theme),
    reason: `${theme}が引っかかっている。`,
    voiceTop: `ゆずるさん、${title}で行く案がある。`,
    timestamp: Date.parse("2026-05-28T00:00:00.000Z")
  };
}

function proposal(id: string, title: string): SpawnProposal {
  return {
    proposalId: id,
    createdAt: "2026-05-28T00:00:00.000Z",
    status: "draft",
    title,
    voiceTop: `ゆずるさん、${title}で行く案がある。`,
    coreTheme: `${title}の違和感を切る`,
    observationSources: [
      { kind: "news", label: "news", quote: `${title}の観察`, url: "https://example.com/news" }
    ],
    motifRank: 1,
    cascadeTrace: {
      observationSources: [
        { kind: "news", label: "news", quote: `${title}の観察`, url: "https://example.com/news" }
      ],
      artistVoice: `ゆずるさん、${title}で行く案がある。`,
      title,
      lyricsTheme: `${title}の違和感を切る`,
      styleLayer: "thick bass, restrained hi-hats, dry male vocal"
    }
  };
}

function requestBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("spawn proposal notification", () => {
  it("collapses same-tick spawn proposals to the latest single proposal notification", async () => {
    const root = workspace();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl });

    await Promise.all([
      notifier.notify(event("spawn_a", "ハンズ前、解散", "東急ハンズ前の待ち合わせ")),
      notifier.notify(event("spawn_b", "地下鉄のコピー機", "地下鉄の白い灯り"))
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const sendBody = requestBody(fetchImpl.mock.calls[0]);
    expect(sendBody.text).not.toContain("アイデアが 2 件、並んでます。");
    expect(sendBody.text).not.toContain("ハンズ前、解散");
    expect(sendBody.text).toContain("地下鉄のコピー機");
    expect(sendBody.text).toContain("素案: 地下鉄のコピー機");
    expect(sendBody.text).toContain("次:\nボタンで選ぶ");
    expect(sendBody.text).not.toContain("行程 trace:");

    const markup = requestBody(fetchImpl.mock.calls[1]).reply_markup as { inline_keyboard: Array<Array<{ text: string }>> };
    expect(markup.inline_keyboard).toHaveLength(1);
    expect(markup.inline_keyboard.map((row) => row.map((button) => button.text))).toEqual([
      ["作る", "保留する", "修正する"]
    ]);
    expect((await readCallbackActionEntries(root)).map((entry) => entry.action).sort()).toEqual([
      "song_spawn_edit",
      "song_spawn_inject",
      "song_spawn_skip"
    ]);
  });

  it("keeps the single-proposal narrative notification path", async () => {
    const root = workspace();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 88, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));

    await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: root, fetchImpl }).notify(
      event("spawn_single", "路地裏の審判", "六本木の路地裏")
    );

    const sendBody = requestBody(fetchImpl.mock.calls[0]);
    expect(sendBody.text).not.toContain("アイデアが 1 件");
    expect(sendBody.text).toContain("素案: 路地裏の審判");
    expect(sendBody.text).toContain("路地裏の審判");
    expect(sendBody.text).toContain("次:\nボタンで選ぶ");
    expect(sendBody.text).not.toContain("行程 trace:");
    const markup = requestBody(fetchImpl.mock.calls[1]).reply_markup as { inline_keyboard: Array<Array<{ text: string }>> };
    expect(markup.inline_keyboard).toEqual([[
      expect.objectContaining({ text: "作る" }),
      expect.objectContaining({ text: "保留する" }),
      expect.objectContaining({ text: "修正する" })
    ]]);
  });

  it("exposes pending proposals to the Producer Console queue panel", async () => {
    clearSpawnProposalQueueCacheForTest();
    const root = workspace();
    await appendSpawnProposal(root, proposal("proposal_1", "ハンズ前、解散"));
    await appendSpawnProposal(root, proposal("proposal_2", "地下鉄のコピー機"));

    const response = await buildSpawnProposalsResponse({
      config: { artist: { workspaceRoot: root } },
      requestPath: "/plugins/artist-runtime/api/spawn-proposals?status=draft&limit=20"
    });
    const html = renderToStaticMarkup(
      React.createElement(SpawnProposalQueuePanel, {
        count: response.count,
        proposals: response.proposals
      })
    );

    expect(response.count).toBe(2);
    expect(response.proposals[0].actions.map((action) => action.label)).toEqual(["作る", "保留する", "修正する"]);
    expect(html).toContain("永続草稿箱");
    expect(html).toContain("ハンズ前、解散");
    expect(html).toContain("この草稿で曲を完成まで作る。外部公開はしない。");
    expect(html).toContain("Telegram の草稿カード、または上のボタンから実行できます。");
  });

  it("describes proposal button effects in plain Japanese", () => {
    expect(describeCallbackActionEffect("song_spawn_inject")).toMatchObject({
      label: "作る",
      effect: "この草稿で曲を完成まで作る。外部公開はしない。"
    });
    expect(describeCallbackActionEffect("song_spawn_skip")).toMatchObject({
      label: "保留する",
      effect: "この着想を保留する。"
    });
    expect(describeCallbackActionEffect("song_spawn_edit")).toMatchObject({
      label: "修正する",
      effect: "この commission を編集する。"
    });
  });
});
