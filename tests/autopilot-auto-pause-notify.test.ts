import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAutoPauseEvent,
  readAutopilotRunState,
  writeStageState
} from "../src/services/autopilotService";
import { AutopilotControlService } from "../src/services/autopilotControlService";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import { formatRuntimeEvent, isTelegramSignalEvent, isTelegramSilentEvent } from "../src/services/telegramNotifier";
import type { AutopilotRunState } from "../src/types";

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-auto-pause-"));
}

function runningState(overrides: Partial<AutopilotRunState> = {}): AutopilotRunState {
  return {
    runId: "auto-1",
    currentSongId: "song-042",
    stage: "suno_generation",
    paused: false,
    retryCount: 0,
    cycleCount: 3,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function collectEvents(): { events: RuntimeEvent[]; stop: () => void } {
  const events: RuntimeEvent[] = [];
  const stop = getRuntimeEventBus().subscribe((event) => {
    events.push(event);
  });
  return { events, stop };
}

afterEach(() => {
  getRuntimeEventBus().clearForTest();
});

describe("buildAutoPauseEvent", () => {
  it("returns an event on the not-paused -> paused edge, carrying pausedReason", () => {
    const event = buildAutoPauseEvent(
      { paused: false, stage: "suno_generation" },
      { paused: true, stage: "paused", currentSongId: "song-042", pausedReason: "suno_generate_failed:x", blockedReason: "b" }
    );
    expect(event).toEqual({
      type: "autopilot_auto_paused",
      songId: "song-042",
      reason: "suno_generate_failed:x",
      previousStage: "suno_generation",
      timestamp: expect.any(Number)
    });
  });

  it("falls back to blockedReason then a default when pausedReason is absent", () => {
    expect(buildAutoPauseEvent({ paused: false, stage: "planning" }, { paused: true, stage: "paused", blockedReason: "take_attribution_collision_blocked" })?.reason)
      .toBe("take_attribution_collision_blocked");
    expect(buildAutoPauseEvent({ paused: false, stage: "planning" }, { paused: true, stage: "paused" })?.reason)
      .toBe("autopilot paused");
  });

  it("returns undefined when already paused (a resurface, not a fresh pause)", () => {
    expect(buildAutoPauseEvent(
      { paused: true, stage: "paused" },
      { paused: true, stage: "paused", pausedReason: "still paused" }
    )).toBeUndefined();
  });

  it("returns undefined when the next state is not paused-flagged (e.g. producer-review suspension)", () => {
    expect(buildAutoPauseEvent(
      { paused: false, stage: "take_selection" },
      { paused: false, stage: "paused", blockedReason: "producer_review_after_take_selected" }
    )).toBeUndefined();
  });
});

describe("writeStageState self-pause notification", () => {
  it("emits autopilot_auto_paused exactly once when the pipeline pauses itself", async () => {
    const root = tempWorkspace();
    const { events, stop } = collectEvents();

    const written = await writeStageState(root, runningState(), runningState({
      stage: "paused",
      paused: true,
      pausedReason: "suno_generate_failed:suno_cdp_endpoint_unreachable"
    }));
    stop();

    expect(written.paused).toBe(true);
    const persisted = await readAutopilotRunState(root);
    expect(persisted.paused).toBe(true);

    const autoPauses = events.filter((event) => event.type === "autopilot_auto_paused");
    expect(autoPauses).toHaveLength(1);
    expect(autoPauses[0]).toMatchObject({
      songId: "song-042",
      reason: "suno_generate_failed:suno_cdp_endpoint_unreachable"
    });
  });

  it("stays silent on a paused -> paused resurface tick", async () => {
    const root = tempWorkspace();
    const { events, stop } = collectEvents();

    await writeStageState(
      root,
      runningState({ stage: "paused", paused: true, pausedReason: "planning_stalled_7days" }),
      runningState({ stage: "paused", paused: true, pausedReason: "planning_stalled_7days" })
    );
    stop();

    expect(events.filter((event) => event.type === "autopilot_auto_paused")).toHaveLength(0);
  });

  it("persists the pause even when a notification subscriber throws", async () => {
    const root = tempWorkspace();
    const stop = getRuntimeEventBus().subscribe((event) => {
      if (event.type === "autopilot_auto_paused") {
        throw new Error("notify boom");
      }
    });

    const written = await writeStageState(root, runningState(), runningState({
      stage: "paused",
      paused: true,
      pausedReason: "song_completion_failed"
    }));
    stop();

    expect(written.paused).toBe(true);
    const persisted = await readAutopilotRunState(root);
    expect(persisted.paused).toBe(true);
    expect(persisted.pausedReason).toBe("song_completion_failed");
  });
});

describe("manual pause vs self-pause", () => {
  it("does not emit autopilot_auto_paused when the operator pauses manually", async () => {
    const root = tempWorkspace();
    const { events, stop } = collectEvents();

    await new AutopilotControlService().pause(root, "paused by operator");
    stop();

    expect(events.some((event) => event.type === "autopilot_auto_paused")).toBe(false);
    expect(events.some((event) => event.type === "autopilot_state_changed")).toBe(true);
  });
});

describe("telegram routing for pause events", () => {
  it("treats a self-pause as a signal event and renders reason + resume path", async () => {
    const event: RuntimeEvent = {
      type: "autopilot_auto_paused",
      songId: "song-042",
      reason: "suno_generate_failed:suno_cdp_endpoint_unreachable",
      previousStage: "suno_generation",
      timestamp: Date.now()
    };
    expect(isTelegramSignalEvent(event)).toBe(true);
    const text = await formatRuntimeEvent(event);
    expect(text).toContain("song: song-042");
    expect(text).toContain("/resume");
    expect(text).toContain("POST /api/resume");
    // The CDP-down reason surfaces the actionable "start the external Chrome" hint.
    expect(text).toContain("Suno Chrome");
  });

  it("keeps a manual pause (autopilot_state_changed) silent", () => {
    const event: RuntimeEvent = {
      type: "autopilot_state_changed",
      enabled: true,
      paused: true,
      reason: "paused by operator",
      timestamp: Date.now()
    };
    expect(isTelegramSilentEvent(event)).toBe(true);
  });
});
