import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TelegramNotifier,
  isTelegramSilentEvent,
  formatRuntimeEvent
} from "../src/services/telegramNotifier";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";
import { createSongIdea } from "../src/services/songIdeation";

const STATE_CHANGED: RuntimeEvent = {
  type: "autopilot_state_changed",
  enabled: true,
  paused: false,
  reason: "ran",
  timestamp: 0
};

const THEME_GENERATED: RuntimeEvent = {
  type: "theme_generated",
  theme: "社会風刺",
  reason: "motif anchor: themes: 社会風刺 | geo: 六本木",
  timestamp: 0
};

const ARTIST_PULSE_WITH_HTML_LEAK: RuntimeEvent = {
  type: "artist_pulse_drafted",
  voiceKind: "musing",
  draftText: "本文の前半。\n<!-- voice contract fallback: ending mismatch -->\n本文の後半。",
  draftHash: "abcdef1234567890",
  charCount: 42,
  sourceFragments: [],
  createdAt: "2026-05-09T00:00:00.000Z",
  timestamp: 0
};

const MACHINE_MARKERS = [
  "ARTIST.md",
  "SOUL.md",
  "INNER.md",
  "PRODUCER.md",
  "IDENTITY.md",
  "themes:",
  "geo:",
  "vocab:",
  "sound:",
  "motif anchor:",
  "TBD",
  "基礎人格",
  "基礎トーン",
  "に基づき",
  "を変換",
  "parse",
  "build",
  "field",
  "config",
  "runtime",
  "mock"
];

function expectNoMachineMarkers(value: string): void {
  for (const marker of MACHINE_MARKERS) {
    expect(value).not.toContain(marker);
  }
}

function makeOkResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("voice no-machine-leak contract (v10.16)", () => {
  it("isTelegramSilentEvent returns true for autopilot_state_changed", () => {
    expect(isTelegramSilentEvent(STATE_CHANGED)).toBe(true);
  });

  it("isTelegramSilentEvent returns true for theme_generated", () => {
    expect(isTelegramSilentEvent(THEME_GENERATED)).toBe(true);
  });

  it("TelegramNotifier.notify does NOT call fetch for autopilot_state_changed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    const notifier = new TelegramNotifier({
      token: "test-token",
      chatId: "test-chat",
      fetchImpl: fetchImpl as never
    });
    await notifier.notify(STATE_CHANGED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("TelegramNotifier.notify does NOT call fetch for theme_generated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    const notifier = new TelegramNotifier({
      token: "test-token",
      chatId: "test-chat",
      fetchImpl: fetchImpl as never
    });
    await notifier.notify(THEME_GENERATED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("formatRuntimeEvent strips embedded HTML comments from voice text", async () => {
    const result = await formatRuntimeEvent(ARTIST_PULSE_WITH_HTML_LEAK);
    expect(result).not.toContain("<!--");
    expect(result).not.toContain("voice contract fallback");
    expect(result).toContain("本文の前半");
    expect(result).toContain("本文の後半");
  });

  it("formatRuntimeEvent for autopilot_state_changed has no motif anchor paste (status-only line)", async () => {
    const stateText = await formatRuntimeEvent(STATE_CHANGED);
    expect(stateText).not.toContain("motif anchor: themes:");
    expect(stateText).not.toContain("<!--");
  });

  it("notify path keeps motif anchor strings out of Telegram for silent events", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse());
    const notifier = new TelegramNotifier({
      token: "test-token",
      chatId: "test-chat",
      fetchImpl: fetchImpl as never
    });
    await notifier.notify(THEME_GENERATED);
    const calledWithMotifAnchor = fetchImpl.mock.calls.some((call) =>
      String(call[1]?.body ?? "").includes("motif anchor: themes:")
    );
    expect(calledWithMotifAnchor).toBe(false);
  });

  it("song_spawn_proposed metadata speaks timing and mood without raw spec labels", async () => {
    const text = await formatRuntimeEvent({
      type: "song_spawn_proposed",
      voiceTop: "ゆずる、再開発の街を切るやつ、刺さる",
      candidateSongId: "spawn_voice",
      brief: {
        songId: "spawn_voice",
        title: "Backyard Cure",
        brief: "街が治るふりをする夜。",
        lyricsTheme: "街が治るふりをする夜",
        mood: "tense, cynical, urgent",
        tempo: "88 BPM",
        duration: "3:00",
        styleNotes: "dry drums",
        sourceText: "autopilot spawn",
        createdAt: "2026-05-09T00:00:00.000Z"
      },
      reason: "motif anchor: themes: 社会風刺 | geo: 六本木 | vocab: 経営者 | sound: nu-jazz",
      timestamp: 1
    });

    expectNoMachineMarkers(text);
    expect(text).toContain("voice: ゆずる、再開発の街を切るやつ、刺さる");
    expect(text).toContain("lyrics: 街が治るふりをする夜");
    expect(text).toContain("style: dry drums");
    expect(text).toContain("委ねてみたい");
    expect(text).not.toContain("88 BPM");
    expect(text).not.toContain("tense, cynical, urgent");
  });

  it("brief Artist reason rewrites raw motif anchors into artist first-person craft language", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-voice-brief-"));
    const observationText = "- text: \"tower owners talk like the city is already sold\"\n  author: \"citywatch\"\n  url: \"https://x.com/citywatch/status/99\"";
    const idea = await createSongIdea({
      workspaceRoot: root,
      theme: "themes: 社会風刺/六本木 | geo: 六本木 | vocab: 経営者 | sound: nu-jazz",
      artistReason: "themes: 社会風刺/六本木 | geo: 六本木 | vocab: 経営者 | sound: nu-jazz",
      observationText
    });
    const brief = readFileSync(idea.briefPath, "utf8");
    const reasonLine = brief.split("\n").find((line) => line.startsWith("- Artist reason:")) ?? "";

    expectNoMachineMarkers(reasonLine);
    expect(reasonLine).toContain("六本木の経営者を刺すために、nu-jazzの輪郭で書く。");
    expect(reasonLine).toContain("自分の癖が出る場所だと思う。");
  });

  it("song_take_completed motivation replaces file-name rationale with artist first-person handoff", async () => {
    const text = await formatRuntimeEvent({
      type: "song_take_completed",
      songId: "song-voice",
      selectedTakeId: "take-1",
      urls: ["https://suno.com/song/voice"],
      observationSummary: {
        author: "citywatch",
        url: "https://x.com/citywatch/status/42",
        quote: "old live houses disappear under identical signs",
        motivation: "ARTIST.md の都市観察と SOUL.md の静かな違和感に接続"
      },
      timestamp: 1
    });

    expectNoMachineMarkers(text);
    expect(text).toContain("自分の都市観察と、いまの静かな違和感を、ここに繋いだ");
    expect(text).toContain("聴いてみて、どうだろう。");
    expect(text).toContain("old live houses disappear under identical signs");
  });
});
