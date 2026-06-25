import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { formatRuntimeEvent, TelegramNotifier } from "../src/services/telegramNotifier";
import type { CommissionBrief } from "../src/types";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function longBrief(): CommissionBrief {
  return {
    songId: "spawn_long",
    title: "半額のレジ前",
    brief: "セブンのスムージー半額騒動を入口に、安さが祭りになる怖さを見る。",
    lyricsTheme: "半額のレジ前で、生活が削れる明るさを都市の比喩にする。",
    mood: "tense, cynical, observed",
    tempo: "118 BPM",
    duration: "3:15",
    styleNotes: "nu-jazz rap, restrained drums, warm bass, spacious hook, observational male vocal",
    sourceText: "fixture",
    createdAt: "2026-06-25T00:00:00.000Z",
    sources: [
      { kind: "news", url: "https://example.com/news", author: "City Desk", quote: "半額のレジ前に人が集まり、店内の導線が詰まった。" }
    ]
  };
}

describe("telegram spawn card", () => {
  it("keeps a long spawn proposal in one readable action card", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_long",
      brief: longBrief(),
      voiceTop: "これを長く語りたい。".repeat(120),
      reason: "半額の明るさが生活の怖さを隠している。レジ前で人が導線に流される感じが曲になる。".repeat(60),
      observationSummary: {
        author: "City Desk",
        quote: "半額のレジ前に人が集まり、店内の導線が詰まった。".repeat(20)
      },
      timestamp: 1
    });

    expect(Array.from(text).length).toBeLessThanOrEqual(2400);
    expect(text).toContain("素案: 半額のレジ前");
    expect(text).toContain("今見てるもの:");
    expect(text).toContain("曲にする理由:");
    expect(text).toContain("作る曲:");
    expect(text).toContain("次:\nボタンで選ぶ");
    expect(text).not.toContain("行程 trace:");
    expect(text).not.toContain("voice:");
  });

  it("sends the compact spawn card once and attaches producer buttons to that message", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-card-"));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));

    await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot, fetchImpl }).notify({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_long",
      brief: longBrief(),
      reason: "半額の明るさが怖い。",
      timestamp: 1
    });

    const sendCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/sendMessage"));
    const markupCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    const entries = await readCallbackActionEntries(workspaceRoot);
    expect(sendCalls).toHaveLength(1);
    expect(markupCalls).toHaveLength(1);
    expect(entries.map((entry) => entry.action).sort()).toEqual(["song_spawn_edit", "song_spawn_inject", "song_spawn_skip"].sort());
  });
});
