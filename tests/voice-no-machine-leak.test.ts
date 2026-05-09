import { describe, expect, it, vi } from "vitest";
import {
  TelegramNotifier,
  isTelegramSilentEvent,
  formatRuntimeEvent
} from "../src/services/telegramNotifier";
import type { RuntimeEvent } from "../src/services/runtimeEventBus";

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
});
