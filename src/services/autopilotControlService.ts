import type { AutopilotRunState } from "../types.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import {
  backupAutopilotState,
  buildResetAutopilotState,
  readAutopilotState,
  type AutopilotRecoveryClock,
  writeAutopilotState
} from "./autopilotRecovery.js";

export interface AutopilotResumeOptions {
  resetState?: boolean;
  reason?: string;
  source?: "operator" | "telegram" | "test";
}

export class AutopilotControlService {
  constructor(private readonly clock?: AutopilotRecoveryClock) {}

  async pause(root: string, reason = "paused by operator"): Promise<AutopilotRunState> {
    const current = await readAutopilotState(root);
    const next = await writeAutopilotState(root, {
      ...current,
      paused: true,
      pausedReason: reason,
      stage: "paused"
    });
    emitRuntimeEvent({
      type: "autopilot_state_changed",
      enabled: true,
      paused: true,
      reason,
      timestamp: Date.now()
    });
    return next;
  }

  async resume(root: string, options: AutopilotResumeOptions = {}): Promise<AutopilotRunState> {
    if (options.resetState) {
      await this.backupState(root);
      return writeAutopilotState(root, buildResetAutopilotState(this.clock));
    }

    const current = await readAutopilotState(root);
    // Plan v10.56 Phase 2: resume clears the "stuck" reason (blockedReason) so the
    // next cycle does not immediately re-stall. A user_paused suspension is also a
    // manual pause, so clear it too — but GO-gate suspensions (spawn_proposal_ready /
    // prompt_pack_ready / planning_skeleton_pending) are producer decisions and must
    // survive resume (cleared only by the corresponding GO, not by /resume).
    const clearsSuspension = current.suspendedAt === "user_paused";
    const next = await writeAutopilotState(root, {
      ...current,
      paused: false,
      pausedReason: undefined,
      hardStopReason: undefined,
      blockedReason: undefined,
      suspendedAt: clearsSuspension ? undefined : current.suspendedAt,
      stage: "idle"
    });
    emitRuntimeEvent({
      type: "autopilot_state_changed",
      enabled: true,
      paused: false,
      reason: options.reason,
      timestamp: Date.now()
    });
    return next;
  }

  async backupState(root: string): Promise<{ backupPath?: string }> {
    return backupAutopilotState(root, this.clock);
  }
}
