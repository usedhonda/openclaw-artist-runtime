import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSafeTickTriggerResponse } from "../src/routes";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { resetAutopilotTickerForTest } from "../src/services/autopilotTicker";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import type { AutopilotRunState } from "../src/types";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-safe-tick-"));
}

function nextState(): AutopilotRunState {
  return {
    runId: "safe-recovery",
    stage: "planning",
    paused: false,
    retryCount: 0,
    cycleCount: 2,
    currentSongId: "song-001",
    updatedAt: "2026-05-28T04:00:00.000Z"
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetAutopilotTickerForTest();
  getRuntimeEventBus().clearForTest();
});

describe("safe tick trigger endpoint", () => {
  it("requires an internal token before running the autopilot ticker", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    const runCycle = vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockResolvedValue(nextState());

    await expect(buildSafeTickTriggerResponse({
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } },
      token: "wrong"
    }, { OPENCLAW_SAFE_TICK_TRIGGER_TOKEN: "secret" } as NodeJS.ProcessEnv)).resolves.toMatchObject({
      triggered: false,
      reason: "safe_tick_trigger_unauthorized",
      statusCode: 401
    });
    await expect(buildSafeTickTriggerResponse({
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } },
      token: "secret"
    }, {} as NodeJS.ProcessEnv)).resolves.toMatchObject({
      triggered: false,
      reason: "safe_tick_trigger_token_missing",
      statusCode: 403
    });
    expect(runCycle).not.toHaveBeenCalled();
  });

  it("runs one existing ticker cycle and emits an audit event without bypassing config safety", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const runCycle = vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockResolvedValue(nextState());

    const response = await buildSafeTickTriggerResponse({
      config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } },
      token: "secret"
    }, { OPENCLAW_SAFE_TICK_TRIGGER_TOKEN: "secret" } as NodeJS.ProcessEnv);
    unsubscribe();

    expect(response).toMatchObject({
      triggered: true,
      tickerOutcome: "ran",
      stage: "planning",
      songId: "song-001",
      reason: "autopilot_ticker_safe_recovery",
      statusCode: 200
    });
    expect(runCycle).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: root,
      config: expect.objectContaining({
        autopilot: expect.objectContaining({ dryRun: true })
      })
    }));
    expect(runCycle.mock.calls[0][0].manualSeed).toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({
      type: "autopilot_ticker_safe_recovery",
      outcome: "ran",
      songId: "song-001"
    }));
  });
});
