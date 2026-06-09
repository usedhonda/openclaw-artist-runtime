import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AutopilotControlService } from "../src/services/autopilotControlService";
import { autopilotStateBackupPath } from "../src/services/autopilotRecovery";
import { readAutopilotRunState } from "../src/services/autopilotService";
import type { AutopilotRunState } from "../src/types";

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-autopilot-control-"));
}

function fixedClock() {
  return {
    now: () => new Date("2026-04-27T09:15:00.000Z")
  };
}

async function writeState(root: string, state: AutopilotRunState): Promise<void> {
  await mkdir(join(root, "runtime"), { recursive: true });
  writeFileSync(join(root, "runtime", "autopilot-state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

describe("AutopilotControlService", () => {
  it("pauses through the control service without changing the existing run identity", async () => {
    const root = tempWorkspace();
    await writeState(root, {
      runId: "auto-existing",
      currentSongId: "song-001",
      stage: "suno_generation",
      paused: false,
      retryCount: 2,
      cycleCount: 5,
      updatedAt: "2026-04-27T08:00:00.000Z"
    });

    const service = new AutopilotControlService(fixedClock());
    const paused = await service.pause(root, "maintenance");

    expect(paused.stage).toBe("paused");
    expect(paused.paused).toBe(true);
    expect(paused.pausedReason).toBe("maintenance");
    expect(paused.runId).toBe("auto-existing");
    expect(paused.currentSongId).toBe("song-001");
  });

  it("resumes without reset using the legacy idle-stage behavior", async () => {
    const root = tempWorkspace();
    await writeState(root, {
      runId: "auto-existing",
      currentSongId: "song-001",
      stage: "paused",
      paused: true,
      pausedReason: "maintenance",
      hardStopReason: "operator stop",
      blockedReason: "song_spawn_missing_brief",
      retryCount: 1,
      cycleCount: 3,
      updatedAt: "2026-04-27T08:00:00.000Z"
    });

    const service = new AutopilotControlService(fixedClock());
    const resumed = await service.resume(root);

    expect(resumed.stage).toBe("idle");
    expect(resumed.paused).toBe(false);
    expect(resumed.pausedReason).toBeUndefined();
    expect(resumed.hardStopReason).toBeUndefined();
    expect(resumed.blockedReason).toBeUndefined();
    expect(resumed.runId).toBe("auto-existing");
    expect(resumed.currentSongId).toBe("song-001");
    // Plan v10.66: a manual resume grants a fresh Suno retry budget so an exhausted
    // song re-attempts on the next tick instead of re-failing immediately.
    expect(resumed.retryCount).toBe(0);
  });

  it("clears blockedReason + user_paused suspension but preserves GO-gate suspension on resume (Plan v10.56 Phase 2)", async () => {
    const root = tempWorkspace();
    await writeState(root, {
      runId: "auto-go",
      currentSongId: "spawn_x",
      stage: "paused",
      paused: true,
      suspendedAt: "spawn_proposal_ready",
      blockedReason: "song_spawn_missing_brief",
      retryCount: 0,
      cycleCount: 1,
      updatedAt: "2026-04-27T08:00:00.000Z"
    });

    const service = new AutopilotControlService(fixedClock());
    const resumed = await service.resume(root);

    // blockedReason (詰まり) は解除されるが、GO 待ち (spawn_proposal_ready) は維持。
    expect(resumed.blockedReason).toBeUndefined();
    expect(resumed.suspendedAt).toBe("spawn_proposal_ready");
    expect(resumed.paused).toBe(false);

    // user_paused は手動 pause と同義なので resume で解除される。
    await writeState(root, {
      runId: "auto-up",
      stage: "paused",
      paused: true,
      suspendedAt: "user_paused",
      retryCount: 0,
      cycleCount: 1,
      updatedAt: "2026-04-27T08:00:00.000Z"
    });
    const resumedUserPaused = await service.resume(root);
    expect(resumedUserPaused.suspendedAt).toBeUndefined();
  });

  it("backs up the current state with the colon-less UTC timestamp format", async () => {
    const root = tempWorkspace();
    await writeState(root, {
      runId: "auto-existing",
      stage: "publishing",
      paused: false,
      retryCount: 0,
      cycleCount: 7,
      updatedAt: "2026-04-27T08:00:00.000Z"
    });

    const service = new AutopilotControlService(fixedClock());
    const backup = await service.backupState(root);
    const expectedPath = autopilotStateBackupPath(root, fixedClock().now());

    expect(backup.backupPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, "utf8")).toContain('"runId": "auto-existing"');
  });

  it("resets to a fresh planning state and preserves the backup file", async () => {
    const root = tempWorkspace();
    await writeState(root, {
      runId: "auto-existing",
      currentSongId: "song-001",
      stage: "failed_closed",
      paused: true,
      pausedReason: "manual pause",
      hardStopReason: "selector mismatch",
      blockedReason: "selector mismatch",
      lastError: "boom",
      lastSuccessfulStage: "suno_generation",
      retryCount: 4,
      cycleCount: 9,
      updatedAt: "2026-04-27T08:00:00.000Z"
    });

    const service = new AutopilotControlService(fixedClock());
    const reset = await service.resume(root, {
      resetState: true,
      reason: "operator recovery",
      source: "test"
    });
    const files = await readdir(join(root, "runtime"));
    const persisted = await readAutopilotRunState(root);

    expect(reset).toMatchObject({
      stage: "planning",
      paused: false,
      retryCount: 0,
      cycleCount: 0,
      lastRunAt: "2026-04-27T09:15:00.000Z",
      blockedReason: null,
      hardStopReason: null
    });
    expect(reset.runId).toBeUndefined();
    expect(reset.currentSongId).toBeUndefined();
    expect(persisted.stage).toBe("planning");
    expect(files).toContain("autopilot-state.backup.20260427T091500Z.json");
  });
});
