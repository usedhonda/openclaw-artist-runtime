import { describe, expect, it, vi } from "vitest";
import {
  HumanAssistSunoConnector,
  createHumanAssistNotifier,
  CLI_BLOCKED_CAPTCHA_REASON,
  HUMAN_ASSIST_CREATED_REASON
} from "../src/connectors/suno/humanAssistSunoConnector";
import { HUMAN_ASSIST_TIMEOUT_REASON, type HumanAssistBrowserDriver } from "../src/services/sunoHumanAssist";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";
import type { SunoConnector } from "../src/connectors/suno/SunoConnector";
import type { SunoCreateRequest, SunoCreateResult, SunoWorkerStatus } from "../src/types";

function innerReturning(result: SunoCreateResult): { connector: SunoConnector; createCalls: SunoCreateRequest[] } {
  const createCalls: SunoCreateRequest[] = [];
  const connector: SunoConnector = {
    status: async (): Promise<SunoWorkerStatus> => ({ state: "connected", connected: true, lastTransitionAt: "t" }),
    create: async (input) => {
      createCalls.push(input);
      return { ...result, runId: result.runId };
    },
    importResults: async () => ({ urls: [] })
  };
  return { connector, createCalls };
}

function stubDriver(outcome: "machine_accepted" | "captcha_then_human" | "captcha_then_timeout"): HumanAssistBrowserDriver {
  return {
    openAndFill: async () => undefined,
    attemptMachineSubmit: async () =>
      outcome === "machine_accepted"
        ? { kind: "accepted", urls: ["https://suno.com/song/aaaaaaaaaaaaaaaa", "https://suno.com/song/bbbbbbbbbbbbbbbb"] }
        : { kind: "captcha_challenge" },
    closeChallengeOverlay: async () => undefined,
    bringToFront: async () => undefined,
    waitForHumanSubmit: async () =>
      outcome === "captcha_then_human"
        ? { kind: "accepted", urls: ["https://suno.com/song/cccccccccccccccc", "https://suno.com/song/dddddddddddddddd"] }
        : { kind: "timeout" },
    close: async () => undefined
  };
}

const request: SunoCreateRequest = {
  dryRun: false,
  authority: "auto_create_and_select_take",
  payload: { songName: "Neon Alley", styleAndFeel: "tense nu-jazz" },
  songId: "song-1",
  runId: "run-1"
};

const notifierSpy = { awaitingHumanCreate: vi.fn() };

function connectorWith(inner: SunoConnector, driver: HumanAssistBrowserDriver, timeoutMs = 1000) {
  return new HumanAssistSunoConnector(inner, {
    timeoutMs,
    driverFactory: () => driver,
    notifier: notifierSpy
  });
}

describe("HumanAssistSunoConnector", () => {
  it("passes an accepted CLI result straight through without opening the browser", async () => {
    const { connector, createCalls } = innerReturning({ accepted: true, runId: "run-1", reason: "ok", urls: ["u1", "u2"] });
    const driverFactory = vi.fn();
    const decorated = new HumanAssistSunoConnector(connector, { timeoutMs: 1000, driverFactory, notifier: notifierSpy });

    const result = await decorated.create(request);

    expect(result.accepted).toBe(true);
    expect(createCalls).toHaveLength(1);
    expect(driverFactory).not.toHaveBeenCalled();
  });

  it("passes a non-captcha failure through unchanged without the fallback", async () => {
    const { connector } = innerReturning({ accepted: false, runId: "run-1", reason: "suno_cli_schema_drift", urls: [] });
    const driverFactory = vi.fn();
    const decorated = new HumanAssistSunoConnector(connector, { timeoutMs: 1000, driverFactory, notifier: notifierSpy });

    const result = await decorated.create(request);

    expect(result.reason).toBe("suno_cli_schema_drift");
    expect(driverFactory).not.toHaveBeenCalled();
  });

  it("never runs the fallback on a dry-run captcha result", async () => {
    const { connector } = innerReturning({ accepted: false, runId: "run-1", reason: CLI_BLOCKED_CAPTCHA_REASON, urls: [] });
    const driverFactory = vi.fn();
    const decorated = new HumanAssistSunoConnector(connector, { timeoutMs: 1000, driverFactory, notifier: notifierSpy });

    const result = await decorated.create({ ...request, dryRun: true });

    expect(result.reason).toBe(CLI_BLOCKED_CAPTCHA_REASON);
    expect(driverFactory).not.toHaveBeenCalled();
  });

  it("accepts via a machine submit when the browser click clears without a captcha", async () => {
    const { connector } = innerReturning({ accepted: false, runId: "run-1", reason: CLI_BLOCKED_CAPTCHA_REASON, urls: [] });
    const decorated = connectorWith(connector, stubDriver("machine_accepted"));

    const result = await decorated.create(request);

    expect(result.accepted).toBe(true);
    expect(result.reason).toBe(HUMAN_ASSIST_CREATED_REASON);
    expect(result.runId).toBe("run-1");
    expect(result.urls).toHaveLength(2);
    expect(result.pendingTakeUrl).toBe("https://suno.com/song/aaaaaaaaaaaaaaaa");
  });

  it("accepts via a manual human Create click after a captcha challenge", async () => {
    const { connector } = innerReturning({ accepted: false, runId: "run-1", reason: CLI_BLOCKED_CAPTCHA_REASON, urls: [] });
    const decorated = connectorWith(connector, stubDriver("captcha_then_human"));

    const result = await decorated.create(request);

    expect(result.accepted).toBe(true);
    expect(result.reason).toBe(HUMAN_ASSIST_CREATED_REASON);
    expect(result.urls).toEqual([
      "https://suno.com/song/cccccccccccccccc",
      "https://suno.com/song/dddddddddddddddd"
    ]);
  });

  it("surfaces a timeout reason when the producer never presses Create", async () => {
    const { connector } = innerReturning({ accepted: false, runId: "run-1", reason: CLI_BLOCKED_CAPTCHA_REASON, urls: [] });
    const decorated = connectorWith(connector, stubDriver("captcha_then_timeout"));

    const result = await decorated.create(request);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe(HUMAN_ASSIST_TIMEOUT_REASON);
    expect(result.urls).toEqual([]);
  });
});

describe("createHumanAssistNotifier", () => {
  it("emits a single suno_human_assist_requested runtime event with the wait window", async () => {
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    createHumanAssistNotifier(45).awaitingHumanCreate({ songId: "song-1", title: "Neon Alley" });

    unsubscribe();
    const requested = events.filter((event) => event.type === "suno_human_assist_requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      type: "suno_human_assist_requested",
      songId: "song-1",
      title: "Neon Alley",
      timeoutMinutes: 45
    });
  });
});
