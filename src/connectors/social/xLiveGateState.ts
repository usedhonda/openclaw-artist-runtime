export type XLiveGateState =
  | "idle"
  | "armedGlobal"
  | "armedPlatform"
  | "armedExplicitGo"
  | "liveAttempt"
  | "success"
  | "failed";

export interface XLiveGateInput {
  distributionEnabled?: boolean;
  globalLiveGoArmed?: boolean;
  platformEnabled?: boolean;
  platformLiveGoArmed?: boolean;
  explicitLiveGo?: boolean;
}

export interface XLiveGateResult {
  state: XLiveGateState;
  reason: string;
}

export function evaluateGate(_input: XLiveGateInput = {}): XLiveGateResult {
  return { state: "idle", reason: "skeleton_default_idle" };
}
