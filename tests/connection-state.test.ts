import { describe, expect, it } from "vitest";
import { deriveConnectionState } from "../src/services/connectionState";

describe("connection state", () => {
  it("reports connected when refresh is current and no error exists", () => {
    expect(deriveConnectionState({ now: 20_000, lastRefreshAt: 18_000 })).toMatchObject({ state: "connected" });
  });

  it("reports stale when the last successful refresh is older than the threshold", () => {
    expect(deriveConnectionState({ now: 40_000, lastRefreshAt: 20_000, staleMs: 15_000 })).toMatchObject({ state: "stale" });
  });

  it("reports offline for a stored network error", () => {
    expect(deriveConnectionState({ now: 40_000, lastRefreshAt: 20_000, networkError: "timeout" })).toMatchObject({
      state: "offline",
      lastError: "timeout"
    });
  });

  it("reports reconnecting while a refresh is in flight after an error", () => {
    expect(deriveConnectionState({ now: 40_000, lastRefreshAt: 20_000, networkError: "timeout", isRefreshing: true })).toMatchObject({
      state: "reconnecting"
    });
  });

  it("reports recovered while the recovered window is active", () => {
    expect(deriveConnectionState({ now: 40_000, lastRefreshAt: 39_000, recoveredUntil: 41_000 })).toMatchObject({
      state: "recovered",
      lastError: null
    });
  });
});
