import { describe, expect, it } from "vitest";
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
  it("rejects with browser-gone instead of polling a closed tab forever", async () => {
    const driver = new CdpHumanAssistDriver({ payload: {} } as never);
    // Simulate the producer having closed the create tab while the wait is armed.
    (driver as unknown as { page: Pick<Page, "isClosed"> }).page = { isClosed: () => true };

    // Even an unbounded wait must reject at once when the target is dead.
    await expect(driver.waitForHumanSubmit(Infinity)).rejects.toThrow(HUMAN_ASSIST_BROWSER_GONE_REASON);
  });
});
