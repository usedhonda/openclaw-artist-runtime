import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutopilotTicker,
  getLastOutcome,
  getLastTickAt,
  getAutopilotTicker,
  resetAutopilotTickerForTest,
  type AutopilotTickOutcome
} from "../src/services/autopilotTicker.js";
import { ArtistAutopilotService } from "../src/services/autopilotService.js";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus.js";

function makeWorkspace(state: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "autopilot-ticker-"));
  mkdirSync(join(root, "runtime"), { recursive: true });
  writeFileSync(join(root, "runtime", "autopilot-state.json"), JSON.stringify(state), "utf8");
  return root;
}

describe("AutopilotTicker", () => {
  beforeEach(() => {
    resetAutopilotTickerForTest();
    getRuntimeEventBus().clearForTest();
  });

  afterEach(() => {
    resetAutopilotTickerForTest();
    getRuntimeEventBus().clearForTest();
    delete process.env.OPENCLAW_AUTOPILOT_TICK_STALL_MS;
  });

  it("returns skipped:disabled when autopilot.enabled=false", async () => {
    const outcomes: AutopilotTickOutcome[] = [];
    const ticker = new AutopilotTicker({ onOutcome: (o) => outcomes.push(o) });
    const result = await ticker.tick({ autopilot: { enabled: false } });
    expect(result).toBe("skipped:disabled");
    expect(outcomes).toEqual(["skipped:disabled"]);
  });

  it("returns skipped:paused when state.paused=true", async () => {
    const root = makeWorkspace({ paused: true, stage: "paused" });
    const ticker = new AutopilotTicker();
    const result = await ticker.tick({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });
    expect(result).toBe("skipped:paused");
  });

  it("returns skipped:hardStop when hardStopReason is set", async () => {
    const root = makeWorkspace({ paused: false, hardStopReason: "test stop", stage: "failed_closed" });
    const ticker = new AutopilotTicker();
    const result = await ticker.tick({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });
    expect(result).toBe("skipped:hardStop");
  });

  it("runs a cycle when enabled and not paused/hardStopped (dry-run)", async () => {
    const root = makeWorkspace({ paused: false, stage: "idle" });
    const ticker = new AutopilotTicker();
    const result = await ticker.tick({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });
    expect(result).toBe("ran");
  });

  it("tracks the last outcome and tick time for status surfaces", async () => {
    const root = makeWorkspace({ paused: false, stage: "idle" });
    const ticker = new AutopilotTicker();

    await ticker.tick({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });

    expect(getLastOutcome()).toBe("ran");
    expect(getLastTickAt()).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("start/stop cleanly manages the interval handle", () => {
    const ticker = new AutopilotTicker({ intervalMs: 100 });
    ticker.start();
    ticker.start();
    ticker.stop();
    ticker.stop();
  });

  it("getAutopilotTicker returns the same singleton instance", () => {
    const a = getAutopilotTicker();
    const b = getAutopilotTicker();
    expect(a).toBe(b);
  });

  it("recovers a stalled running flag after the watchdog window", async () => {
    process.env.OPENCLAW_AUTOPILOT_TICK_STALL_MS = "1";
    const root = makeWorkspace({ paused: false, stage: "idle" });
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const runCycle = vi
      .spyOn(ArtistAutopilotService.prototype, "runCycle")
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({
        runId: "recovered",
        stage: "planning",
        paused: false,
        retryCount: 0,
        cycleCount: 1,
        updatedAt: new Date().toISOString()
      });
    const ticker = new AutopilotTicker();

    void ticker.runNow({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await ticker.runNow({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });
    unsubscribe();

    expect(result.outcome).toBe("ran");
    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.type === "error" && event.source === "autopilot_ticker_stall")).toBe(true);
  });
});
