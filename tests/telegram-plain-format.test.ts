import { describe, expect, it, vi } from "vitest";
import { truncatePlain } from "../src/services/telegramFormatting";
import { formatRuntimeEvent, TelegramNotifier } from "../src/services/telegramNotifier";

function telegramResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

describe("telegram plain format", () => {
  it("does not include HTML markup in the spawn action card", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_plain",
      brief: {
        songId: "spawn_plain",
        title: "タグのない街",
        brief: "タグなしで読めるカード。",
        lyricsTheme: "タグなしで読めるカード。",
        mood: "quiet",
        tempo: "108 BPM",
        duration: "3:15",
        styleNotes: "dry drums",
        sourceText: "fixture",
        createdAt: "2026-06-25T00:00:00.000Z"
      },
      reason: "<b>太字</b> に頼らず読む。",
      timestamp: 1
    });

    expect(text).not.toContain("<b>");
    expect(text).not.toContain("</b>");
    expect(text).not.toContain("<i>");
    expect(text).not.toContain("<code>");
  });

  it("sends spawn cards without parse_mode", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(telegramResponse({ message_id: 1, chat: { id: 123 } }))
      .mockResolvedValueOnce(telegramResponse(true));
    const notifier = new TelegramNotifier({ token: "token", chatId: 123, workspaceRoot: "/tmp", fetchImpl });

    await notifier.notify({
      type: "song_spawn_proposed",
      candidateSongId: "spawn_plain",
      brief: {
        songId: "spawn_plain",
        title: "タグのない街",
        brief: "タグなしで読めるカード。",
        lyricsTheme: "タグなしで読めるカード。",
        mood: "quiet",
        tempo: "108 BPM",
        duration: "3:15",
        styleNotes: "dry drums",
        sourceText: "fixture",
        createdAt: "2026-06-25T00:00:00.000Z"
      },
      reason: "plain text",
      timestamp: 1
    });

    const sendBody = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(sendBody.parse_mode).toBeUndefined();
  });

  it("strips long HTML tags before truncating plain Telegram text", () => {
    const longHref = `<a href="https://news.google.com/rss/articles/${"x".repeat(160)}">ナフサと赤星</a>`;

    const text = truncatePlain(longHref, 80);

    expect(text).toBe("ナフサと赤星");
    expect(text).not.toContain("<a");
    expect(text).not.toContain("href=");
  });
});
