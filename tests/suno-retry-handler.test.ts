import { describe, expect, it } from "vitest";
import type { AutopilotRunState } from "../src/types";
import { classifySunoGenerateFailure, nextSunoRetryDecision } from "../src/services/sunoRetryHandler";

function state(patch: Partial<AutopilotRunState>): AutopilotRunState {
  return {
    stage: "suno_generation",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: "2026-04-29T00:00:00.000Z",
    ...patch
  };
}

describe("suno retry handler", () => {
  it("allows the first generation attempt", () => {
    expect(nextSunoRetryDecision(state({ retryCount: 0 })).action).toBe("ready");
  });

  it("waits until exponential backoff has elapsed", () => {
    const decision = nextSunoRetryDecision(state({
      retryCount: 2,
      lastRunAt: "2026-04-29T00:00:00.000Z"
    }), {
      now: new Date("2026-04-29T00:06:00.000Z"),
      baseDelayMs: 5 * 60 * 1000
    });

    expect(decision).toMatchObject({ action: "wait" });
  });

  it("fails closed after max retries", () => {
    expect(nextSunoRetryDecision(state({ retryCount: 3 }), { maxRetries: 3 })).toMatchObject({
      action: "failed",
      reason: "suno_generate_failed_after_3_retries"
    });
  });

  it("maps thrown errors to safe reasons", () => {
    expect(classifySunoGenerateFailure(new Error("missing Suno payload"))).toBe("missing Suno payload");
  });
});
