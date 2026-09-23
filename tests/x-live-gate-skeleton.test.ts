import { describe, expect, it } from "vitest";
import { evaluateGate } from "../src/connectors/social/xLiveGateState.js";

describe("X live gate skeleton", () => {
  it("returns idle when no input is supplied", () => {
    expect(evaluateGate()).toEqual({ state: "idle", reason: "skeleton_default_idle" });
  });

  it("returns idle even when every arm flag is true (skeleton always fail-closed)", () => {
    expect(
      evaluateGate({
        distributionEnabled: true,
        globalLiveGoArmed: true,
        platformEnabled: true,
        platformLiveGoArmed: true,
        explicitLiveGo: true
      })
    ).toEqual({ state: "idle", reason: "skeleton_default_idle" });
  });

  it("returns idle for partially armed combinations", () => {
    const cases = [
      { distributionEnabled: true },
      { globalLiveGoArmed: true, platformLiveGoArmed: true },
      { explicitLiveGo: true }
    ];
    for (const input of cases) {
      expect(evaluateGate(input).state).toBe("idle");
    }
  });
});
