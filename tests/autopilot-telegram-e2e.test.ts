import { describe, expect, it, vi } from "vitest";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { TelegramNotifier } from "../src/services/telegramNotifier";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}

describe("autopilot to Telegram notifier e2e", () => {
  it("pushes a producer-facing runtime event through RuntimeEventBus to TelegramNotifier with mock fetch", async () => {
    const bus = getRuntimeEventBus();
    bus.clearForTest();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: { message_id: 1 }
    }));
    const unsubscribe = new TelegramNotifier({ token: "mock-token", chatId: 100, fetchImpl }).subscribe(bus);

    try {
      bus.emit({
        type: "artist_presence",
        trigger: "observation_high_score",
        text: "ゆずるさん、いま見えたものがある。",
        timestamp: 1
      });

      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      const payloads = fetchImpl.mock.calls.map((call) => JSON.parse(call[1].body as string) as { text: string });
      expect(payloads.some((payload) => payload.text.includes("ゆずるさん、いま見えたものがある。"))).toBe(true);
      expect(payloads.every((payload) => payload.text.includes("publish"))).toBe(false);
    } finally {
      unsubscribe();
      bus.clearForTest();
    }
  });
});
