import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import {
  CdpHumanAssistDriver,
  HUMAN_ASSIST_BROWSER_GONE_REASON,
  assertBrowserAlive
} from "../src/services/cdpHumanAssistDriver";

describe("assertBrowserAlive", () => {
  it("throws the browser-gone reason for an undefined page", () => {
    expect(() => assertBrowserAlive(undefined)).toThrow(HUMAN_ASSIST_BROWSER_GONE_REASON);
  });

  it("throws the browser-gone reason for a closed page", () => {
    expect(() => assertBrowserAlive({ isClosed: () => true })).toThrow(HUMAN_ASSIST_BROWSER_GONE_REASON);
  });

  it("does not throw for a live page", () => {
    expect(() => assertBrowserAlive({ isClosed: () => false })).not.toThrow();
  });
});

describe("CdpHumanAssistDriver.waitForHumanSubmit", () => {
  it("keeps waiting after an unavailable feed and accepts a later matched reconciliation", async () => {
    vi.useFakeTimers();
    try {
      const driver = new CdpHumanAssistDriver({ payload: {} } as never);
      (driver as unknown as { page: Pick<Page, "isClosed"> }).page = { isClosed: () => false };
      (driver as unknown as { submitAtMs: number }).submitAtMs = Date.now();
      const freshTakeUrls = vi.spyOn(driver as never, "freshTakeUrls" as never).mockResolvedValue([
        "https://suno.com/song/fresh-take"
      ] as never);
      const reconcile = vi.spyOn(driver as never, "reconcileTakesFromFeed" as never)
        .mockResolvedValueOnce({ status: "unavailable" } as never)
        .mockResolvedValueOnce({ status: "matched", urls: ["https://suno.com/song/fresh-take"] } as never);

      const resultPromise = driver.waitForHumanSubmit(10_000);
      await Promise.resolve();
      await Promise.resolve();
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(resultPromise).toBeInstanceOf(Promise);

      await vi.advanceTimersByTimeAsync(3_000);
      await expect(resultPromise).resolves.toEqual({
        kind: "accepted",
        urls: ["https://suno.com/song/fresh-take"]
      });
      expect(freshTakeUrls).toHaveBeenCalledTimes(2);
      expect(reconcile).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with browser-gone instead of polling a closed tab forever", async () => {
    const driver = new CdpHumanAssistDriver({ payload: {} } as never);
    // Simulate the producer having closed the create tab while the wait is armed.
    (driver as unknown as { page: Pick<Page, "isClosed"> }).page = { isClosed: () => true };

    // Even an unbounded wait must reject at once when the target is dead.
    await expect(driver.waitForHumanSubmit(Infinity)).rejects.toThrow(HUMAN_ASSIST_BROWSER_GONE_REASON);
  });

  it("fails closed when a manual wait has no preparation freshness floor", async () => {
    const driver = new CdpHumanAssistDriver({ payload: {} } as never);
    (driver as unknown as { page: Pick<Page, "isClosed"> }).page = { isClosed: () => false };
    await expect(driver.waitForHumanSubmit(Infinity)).resolves.toEqual({ kind: "feed_unavailable" });
  });
});
