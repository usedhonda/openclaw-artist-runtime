import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readCallbackActionEntries } from "../src/services/callbackActionRegistry";
import { formatRuntimeEvent, TelegramNotifier } from "../src/services/telegramNotifier";
import type { CommissionBrief } from "../src/types";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

async function root(): Promise<string> {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-narrative-"));
  await mkdir(join(workspaceRoot, "artist"), { recursive: true });
  await writeFile(join(workspaceRoot, "ARTIST.md"), "Core obsessions: 社会風刺\n", "utf8");
  await writeFile(join(workspaceRoot, "SOUL.md"), [
    "# SOUL.md",
    "## Producer (relationship in music-making)",
    "### Producer call",
    "- producer_callname: ゆずるさん",
    "- first_person: 俺",
    "## 文体 variation rule",
    "### sentence_endings",
    "- だ。"
  ].join("\n"), "utf8");
  return workspaceRoot;
}

function brief(): CommissionBrief {
  return {
    songId: "spawn_story",
    title: "地下鉄のコピー機",
    brief: "駅の明るさを社会風刺として見る。",
    lyricsTheme: "地下鉄のコピー機の白さで、働く人の疲れを描く。",
    mood: "tense",
    tempo: "142 BPM",
    duration: "2:45",
    styleNotes: "thick bass, restrained hi-hats, sparse arrangement",
    sourceText: "test",
    createdAt: "2026-05-25T00:00:00.000Z",
    sources: [
      { kind: "news", url: "https://example.com/city", author: "City Desk", quote: "地下鉄のコピー機が深夜も動いている" }
    ]
  };
}

describe("telegram spawn proposed narrative", () => {
  it("renders a readable compact card and removes the old trace-heavy body", async () => {
    const workspaceRoot = await root();
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_story",
      brief: brief(),
      reason: "この観察から曲に入る。",
      voiceTop: "ゆずるさん、地下鉄のコピー機で切る。",
      timestamp: 1
    }, { workspaceRoot });

    expect(text).toContain("素案: 地下鉄のコピー機");
    expect(text).toContain("今見てるもの:");
    expect(text).toContain("地下鉄のコピー機が深夜も動いている");
    expect(text).toContain("曲にする理由:");
    expect(text).toContain("作る曲:");
    expect(text).toContain("次:\nボタンで選ぶ");
    expect(text).not.toContain("voice:");
    expect(text).not.toContain("行程 trace:");
    expect(text).not.toContain("観察元 (この曲が引いた news / X)");
    expect(text).not.toContain("- songId:");
  });

  it("renders news source labels without turning hosts into X handles", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_news",
      brief: brief(),
      reason: "この観察から曲に入る。",
      observationSummary: {
        author: "news.google.com/search",
        quote: "ナフサと赤星をめぐる夜のニュース"
      },
      timestamp: 1
    });

    expect(text).toContain("news.google.com/search: ナフサと赤星");
    expect(text).not.toContain("@newsgooglecomsearch");
  });

  it("attaches readable producer decision buttons without changing callback actions", async () => {
    const workspaceRoot = await root();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));

    await new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot, fetchImpl }).notify({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_story",
      brief: brief(),
      reason: "この観察から曲に入る。",
      voiceTop: "ゆずるさん、地下鉄のコピー機で切る。",
      timestamp: 1
    });

    const entries = await readCallbackActionEntries(workspaceRoot);
    const markupCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("/editMessageReplyMarkup"));
    const markupBody = String((markupCall?.[1] as RequestInit).body);
    expect(entries.map((entry) => entry.action).sort()).toEqual(["song_spawn_edit", "song_spawn_inject", "song_spawn_skip"].sort());
    expect(markupBody).toContain("作る");
    expect(markupBody).toContain("保留する");
    expect(markupBody).toContain("修正する");
  });

  it("supersedes older spawn decision buttons when a newer proposal is sent", async () => {
    const workspaceRoot = await root();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 77, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true))
      .mockResolvedValueOnce(telegramResponse({ message_id: 78, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot, fetchImpl });

    await notifier.notify({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_old",
      brief: { ...brief(), songId: "spawn_old", title: "古い案" },
      reason: "古い観察から曲に入る。",
      timestamp: 1
    });
    await notifier.notify({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_new",
      brief: { ...brief(), songId: "spawn_new", title: "新しい案" },
      reason: "新しい観察から曲に入る。",
      timestamp: 2
    });

    const latest = new Map((await readCallbackActionEntries(workspaceRoot)).map((entry) => [entry.callbackId, entry]));
    const oldSpawn = [...latest.values()].filter((entry) => entry.songId === "spawn_old");
    const newSpawn = [...latest.values()].filter((entry) => entry.songId === "spawn_new");
    expect(oldSpawn.map((entry) => entry.status)).toEqual(["updated", "updated", "updated"]);
    expect(oldSpawn.every((entry) => entry.resolveReason === "superseded_by_new_song_spawn_proposal")).toBe(true);
    expect(newSpawn.map((entry) => entry.status)).toEqual(["pending", "pending", "pending"]);
  });
});
