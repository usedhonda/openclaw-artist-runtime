import { describe, expect, it, vi } from "vitest";
import {
  runHumanAssistCreate,
  HUMAN_ASSIST_TIMEOUT_REASON,
  HUMAN_ASSIST_ERROR_REASON,
  type HumanAssistBrowserDriver,
  type HumanAssistSubmitOutcome,
  type HumanAssistWaitOutcome
} from "../src/services/sunoHumanAssist";

type DriverOverrides = {
  openAndFill?: () => Promise<void>;
  attemptMachineSubmit?: () => Promise<HumanAssistSubmitOutcome>;
  waitForHumanSubmit?: (timeoutMs: number) => Promise<HumanAssistWaitOutcome>;
};

function makeDriver(overrides: DriverOverrides = {}) {
  const calls = {
    openAndFill: 0,
    attemptMachineSubmit: 0,
    closeChallengeOverlay: 0,
    bringToFront: 0,
    waitForHumanSubmit: 0,
    close: 0
  };
  const driver: HumanAssistBrowserDriver = {
    openAndFill: async () => {
      calls.openAndFill += 1;
      if (overrides.openAndFill) return overrides.openAndFill();
    },
    attemptMachineSubmit: async () => {
      calls.attemptMachineSubmit += 1;
      return overrides.attemptMachineSubmit
        ? overrides.attemptMachineSubmit()
        : { kind: "captcha_challenge" };
    },
    closeChallengeOverlay: async () => {
      calls.closeChallengeOverlay += 1;
    },
    bringToFront: async () => {
      calls.bringToFront += 1;
    },
    waitForHumanSubmit: async (timeoutMs: number) => {
      calls.waitForHumanSubmit += 1;
      return overrides.waitForHumanSubmit
        ? overrides.waitForHumanSubmit(timeoutMs)
        : { kind: "timeout" };
    },
    close: async () => {
      calls.close += 1;
    }
  };
  return { driver, calls };
}

describe("runHumanAssistCreate", () => {
  const base = { songId: "song-1", title: "Neon Alley", timeoutMs: 1000 };

  it("returns accepted via machine without alerting or waiting when the machine click succeeds", async () => {
    const notifier = { awaitingHumanCreate: vi.fn() };
    const { driver, calls } = makeDriver({
      attemptMachineSubmit: async () => ({
        kind: "accepted",
        urls: ["https://suno.com/song/aaa", "https://suno.com/song/bbb"]
      })
    });

    const result = await runHumanAssistCreate({ driver, notifier, ...base });

    expect(result).toEqual({
      status: "accepted",
      urls: ["https://suno.com/song/aaa", "https://suno.com/song/bbb"],
      via: "machine"
    });
    expect(notifier.awaitingHumanCreate).not.toHaveBeenCalled();
    expect(calls.closeChallengeOverlay).toBe(0);
    expect(calls.waitForHumanSubmit).toBe(0);
    expect(calls.close).toBe(1);
  });

  it("closes the challenge, alerts once, and returns accepted via human when the producer presses Create", async () => {
    const notifier = { awaitingHumanCreate: vi.fn() };
    const { driver, calls } = makeDriver({
      attemptMachineSubmit: async () => ({ kind: "captcha_challenge" }),
      waitForHumanSubmit: async () => ({
        kind: "accepted",
        urls: ["https://suno.com/song/ccc", "https://suno.com/song/ddd"]
      })
    });

    const result = await runHumanAssistCreate({ driver, notifier, ...base });

    expect(result).toEqual({
      status: "accepted",
      urls: ["https://suno.com/song/ccc", "https://suno.com/song/ddd"],
      via: "human"
    });
    // Challenge is closed (never solved) and the window surfaced before the alert.
    expect(calls.closeChallengeOverlay).toBe(1);
    expect(calls.bringToFront).toBe(1);
    expect(notifier.awaitingHumanCreate).toHaveBeenCalledTimes(1);
    expect(notifier.awaitingHumanCreate).toHaveBeenCalledWith({ songId: "song-1", title: "Neon Alley" });
    expect(calls.close).toBe(1);
  });

  it("returns a timeout reason and alerts exactly once when the producer never clicks", async () => {
    const notifier = { awaitingHumanCreate: vi.fn() };
    const { driver, calls } = makeDriver({
      attemptMachineSubmit: async () => ({ kind: "captcha_challenge" }),
      waitForHumanSubmit: async () => ({ kind: "timeout" })
    });

    const result = await runHumanAssistCreate({ driver, notifier, ...base });

    expect(result).toEqual({ status: "timeout", reason: HUMAN_ASSIST_TIMEOUT_REASON });
    // Re-notify suppression: one attempt fires the awaiting alert at most once.
    expect(notifier.awaitingHumanCreate).toHaveBeenCalledTimes(1);
    expect(calls.close).toBe(1);
  });

  it("fails closed to an error result and never alerts when the browser setup throws", async () => {
    const notifier = { awaitingHumanCreate: vi.fn() };
    const { driver, calls } = makeDriver({
      openAndFill: async () => {
        throw new Error("cdp_unreachable");
      }
    });

    const result = await runHumanAssistCreate({ driver, notifier, ...base });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.reason).toContain(HUMAN_ASSIST_ERROR_REASON);
    expect(notifier.awaitingHumanCreate).not.toHaveBeenCalled();
    expect(calls.attemptMachineSubmit).toBe(0);
    // Browser is still closed exactly once even on the setup failure path.
    expect(calls.close).toBe(1);
  });

  it("propagates a non-captcha machine error without handing off to the human", async () => {
    const notifier = { awaitingHumanCreate: vi.fn() };
    const { driver, calls } = makeDriver({
      attemptMachineSubmit: async () => ({ kind: "error", reason: "playwright_create_login_expired" })
    });

    const result = await runHumanAssistCreate({ driver, notifier, ...base });

    expect(result).toEqual({ status: "error", reason: "playwright_create_login_expired" });
    expect(notifier.awaitingHumanCreate).not.toHaveBeenCalled();
    expect(calls.waitForHumanSubmit).toBe(0);
    expect(calls.close).toBe(1);
  });
});
