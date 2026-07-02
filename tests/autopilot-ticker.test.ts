import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutopilotTicker,
  getLastOutcome,
  getLastTickAt,
  getAutopilotTicker,
  resetAutopilotTickerForTest,
  resolveAutopilotTickConfig,
  type AutopilotTickOutcome
} from "../src/services/autopilotTicker.js";
import { ArtistAutopilotService } from "../src/services/autopilotService.js";
import { patchResolvedConfig } from "../src/services/runtimeConfig.js";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus.js";
import { autopilotHeartbeatPath } from "../src/services/supervisorHealth.js";

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
    delete process.env.OPENCLAW_AUTOPILOT_FAST_CHAIN_MS;
    delete process.env.OPENCLAW_AUTOPILOT_IMPORT_POLL_MS;
    vi.restoreAllMocks();
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

  it("does not skip producer_review_after_take_selected paused state (Phase C wire fix)", async () => {
    const root = makeWorkspace({
      paused: true,
      stage: "take_selection",
      suspendedAt: "producer_review_after_take_selected",
      currentSongId: "spawn_test",
      pausedReason: "take selected after bounded one-shot Suno create; awaiting producer review"
    });
    const ticker = new AutopilotTicker();
    const result = await ticker.tick({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });
    // ticker は producer_review を skip せず runCycle に通す。runCycle 内の
    // runIdeaQueueLane が ideaQueue lane だけ tick する (currentSongId lane は停止維持)。
    expect(result).not.toBe("skipped:paused");
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

  it("writes a heartbeat artifact for external ticker watchers", async () => {
    const root = makeWorkspace({ paused: true, stage: "paused" });
    const ticker = new AutopilotTicker();

    await ticker.tick({
      artist: { workspaceRoot: root },
      autopilot: { enabled: true, dryRun: true }
    });

    const heartbeat = JSON.parse(readFileSync(autopilotHeartbeatPath(root), "utf8")) as Record<string, unknown>;
    expect(heartbeat.lastTickAttempt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(heartbeat.lastTickResult).toBe("skipped:paused");
    expect(heartbeat.currentStage).toBe("paused");
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

  it("fast-chains a follow-up tick when a cycle advances an in-flight song", async () => {
    process.env.OPENCLAW_AUTOPILOT_FAST_CHAIN_MS = "5";
    const root = makeWorkspace({
      paused: false,
      stage: "suno_generation",
      currentSongId: "spawn_chain",
      blockedReason: "waiting for Suno result import"
    });
    const runCycle = vi
      .spyOn(ArtistAutopilotService.prototype, "runCycle")
      // tick 1: import lands -> take_selection (progress, not operator-gated) -> chain
      .mockResolvedValueOnce({
        runId: "r",
        stage: "take_selection",
        paused: false,
        retryCount: 0,
        cycleCount: 1,
        currentSongId: "spawn_chain",
        updatedAt: new Date().toISOString()
      })
      // tick 2 (chained): take selected -> producer review (operator-gated) -> stop
      .mockResolvedValueOnce({
        runId: "r",
        stage: "take_selection",
        paused: true,
        suspendedAt: "producer_review_after_take_selected",
        retryCount: 0,
        cycleCount: 2,
        currentSongId: "spawn_chain",
        updatedAt: new Date().toISOString()
      });
    const ticker = new AutopilotTicker({
      getConfig: () => ({ artist: { workspaceRoot: root }, autopilot: { enabled: true } })
    });

    await ticker.runNow();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(runCycle).toHaveBeenCalledTimes(2);
  });

  it("does not fast-chain when a cycle makes no progress (runaway guard)", async () => {
    process.env.OPENCLAW_AUTOPILOT_FAST_CHAIN_MS = "5";
    const root = makeWorkspace({
      paused: false,
      stage: "suno_generation",
      currentSongId: "spawn_stuck",
      blockedReason: "suno daily budget exhausted"
    });
    const runCycle = vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockResolvedValue({
      runId: "r",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      currentSongId: "spawn_stuck",
      blockedReason: "suno daily budget exhausted",
      updatedAt: new Date().toISOString()
    });
    const ticker = new AutopilotTicker({
      getConfig: () => ({ artist: { workspaceRoot: root }, autopilot: { enabled: true } })
    });

    await ticker.runNow();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(runCycle).toHaveBeenCalledTimes(1);
  });

  it("keeps polling a pending Suno result import instead of waiting the full interval", async () => {
    // Two-tick Suno generation: create accepted, import pending. A no-progress repeat
    // must NOT stop the chain here — the take renders minutes later while the next
    // interval tick is hours away (2026-06-12 incident).
    process.env.OPENCLAW_AUTOPILOT_FAST_CHAIN_MS = "5";
    process.env.OPENCLAW_AUTOPILOT_IMPORT_POLL_MS = "5";
    const root = makeWorkspace({
      paused: false,
      stage: "suno_generation",
      currentSongId: "spawn_oven",
      blockedReason: "waiting for Suno result import"
    });
    const pendingImport = {
      runId: "r",
      stage: "suno_generation" as const,
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      currentSongId: "spawn_oven",
      blockedReason: "waiting for Suno result import",
      updatedAt: new Date().toISOString()
    };
    const runCycle = vi
      .spyOn(ArtistAutopilotService.prototype, "runCycle")
      // tick 1 + polled tick 2: import still pending -> keep polling
      .mockResolvedValueOnce(pendingImport)
      .mockResolvedValueOnce(pendingImport)
      // tick 3: import lands -> producer review gate stops the chain
      .mockResolvedValue({
        ...pendingImport,
        stage: "take_selection",
        paused: true,
        suspendedAt: "producer_review_after_take_selected",
        blockedReason: undefined,
        cycleCount: 3
      });
    const ticker = new AutopilotTicker({
      getConfig: () => ({ artist: { workspaceRoot: root }, autopilot: { enabled: true } })
    });

    await ticker.runNow();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(runCycle.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not poll a pending import when import polling is disabled", async () => {
    process.env.OPENCLAW_AUTOPILOT_FAST_CHAIN_MS = "5";
    process.env.OPENCLAW_AUTOPILOT_IMPORT_POLL_MS = "0";
    const root = makeWorkspace({
      paused: false,
      stage: "suno_generation",
      currentSongId: "spawn_off",
      blockedReason: "waiting for Suno result import"
    });
    const runCycle = vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockResolvedValue({
      runId: "r",
      stage: "suno_generation",
      paused: false,
      retryCount: 0,
      cycleCount: 1,
      currentSongId: "spawn_off",
      blockedReason: "waiting for Suno result import",
      updatedAt: new Date().toISOString()
    });
    const ticker = new AutopilotTicker({
      getConfig: () => ({ artist: { workspaceRoot: root }, autopilot: { enabled: true } })
    });

    await ticker.runNow();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(runCycle).toHaveBeenCalledTimes(1);
  });

  it("does not fast-chain when the advanced cycle is operator-gated (producer review)", async () => {
    process.env.OPENCLAW_AUTOPILOT_FAST_CHAIN_MS = "5";
    const root = makeWorkspace({
      paused: false,
      stage: "take_selection",
      currentSongId: "spawn_gate"
    });
    const runCycle = vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockResolvedValue({
      runId: "r",
      stage: "take_selection",
      paused: true,
      suspendedAt: "producer_review_after_take_selected",
      retryCount: 0,
      cycleCount: 1,
      currentSongId: "spawn_gate",
      updatedAt: new Date().toISOString()
    });
    const ticker = new AutopilotTicker({
      getConfig: () => ({ artist: { workspaceRoot: root }, autopilot: { enabled: true } })
    });

    await ticker.runNow();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(runCycle).toHaveBeenCalledTimes(1);
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

describe("AutopilotTicker config resolution (fail-closed)", () => {
  beforeEach(() => {
    resetAutopilotTickerForTest();
    getRuntimeEventBus().clearForTest();
  });

  afterEach(() => {
    resetAutopilotTickerForTest();
    getRuntimeEventBus().clearForTest();
    delete process.env.OPENCLAW_LOCAL_WORKSPACE;
    vi.restoreAllMocks();
  });

  it("resolves the on-disk playwright driver instead of the default mock driver", async () => {
    const root = mkdtempSync(join(tmpdir(), "autopilot-ticker-cfg-"));
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      music: { suno: { driver: "playwright" } },
      autopilot: { dryRun: false }
    });

    const resolved = await resolveAutopilotTickConfig({ artist: { workspaceRoot: root } });

    expect(resolved.music.suno.driver).toBe("playwright");
    expect(resolved.autopilot.dryRun).toBe(false);
  });

  it("reads disk overrides for the default workspace when no in-memory config is supplied", async () => {
    const root = mkdtempSync(join(tmpdir(), "autopilot-ticker-cfg-default-"));
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      music: { suno: { driver: "playwright" } },
      autopilot: { dryRun: false }
    });
    process.env.OPENCLAW_LOCAL_WORKSPACE = root;

    const resolved = await resolveAutopilotTickConfig(undefined);

    expect(resolved.music.suno.driver).toBe("playwright");
    expect(resolved.autopilot.dryRun).toBe(false);
  });

  it("fails closed and does not run a cycle when the runtime config cannot be read", async () => {
    const root = makeWorkspace({ stage: "idle" });
    writeFileSync(join(root, "runtime", "config-overrides.json"), "{ not valid json", "utf8");
    const runCycle = vi.spyOn(ArtistAutopilotService.prototype, "runCycle");
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const ticker = new AutopilotTicker({ getConfig: () => ({ artist: { workspaceRoot: root } }) });
    const result = await ticker.runNow();

    expect(result.outcome).toBe("error");
    expect(runCycle).not.toHaveBeenCalled();
    expect(result.state.blockedReason).toContain("config_unresolved_fail_closed");
    expect(events.some((event) => event.type === "error" && event.source === "autopilot_config_unresolved")).toBe(true);
    unsubscribe();
  });
});
