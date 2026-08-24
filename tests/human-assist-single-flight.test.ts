import { mkdtempSync } from "node:fs";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HumanAssistSunoConnector, CLI_BLOCKED_CAPTCHA_REASON } from "../src/connectors/suno/humanAssistSunoConnector";
import {
  humanAssistPendingPath,
  evaluateHumanAssistPending,
  writeHumanAssistPending
} from "../src/services/humanAssistPending";
import { evaluateSunoGenerationLimits } from "../src/services/sunoRuns";
import { applyConfigDefaults } from "../src/config/schema";
import type { HumanAssistBrowserDriver } from "../src/services/sunoHumanAssist";
import type { SunoConnector } from "../src/connectors/suno/SunoConnector";
import type { SunoCreateRequest, SunoWorkerStatus } from "../src/types";

function makeRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

const notifier = { awaitingHumanCreate: vi.fn() };

function captchaInner(): SunoConnector {
  return {
    status: async (): Promise<SunoWorkerStatus> => ({ state: "connected", connected: true, lastTransitionAt: "t" }),
    create: async () => ({ accepted: false, runId: "run-1", reason: CLI_BLOCKED_CAPTCHA_REASON, urls: [] }),
    importResults: async () => ({ urls: [] })
  };
}

const request: SunoCreateRequest = {
  dryRun: false,
  authority: "auto_create_and_select_take",
  payload: { songName: "Neon Alley", styleAndFeel: "tense nu-jazz" },
  songId: "song-1",
  runId: "run-1"
};

describe("human-assist single-flight marker (connector)", () => {
  it("writes the marker while the attempt waits and removes it on resolution", async () => {
    const root = makeRoot("artist-runtime-hap-write-");
    const markerPath = humanAssistPendingPath(root);

    // Deferred wait: the test controls when the human "submits".
    let releaseWait: (value: { kind: "accepted"; urls: string[] }) => void = () => {};
    let resolveStarted: () => void = () => {};
    const waitStarted = new Promise<void>((r) => {
      resolveStarted = r;
    });
    const driver: HumanAssistBrowserDriver = {
      openAndFill: async () => undefined,
      attemptMachineSubmit: async () => ({ kind: "captcha_challenge" }),
      closeChallengeOverlay: async () => undefined,
      bringToFront: async () => undefined,
      waitForHumanSubmit: () =>
        new Promise((resolveWait) => {
          releaseWait = resolveWait;
          resolveStarted();
        }),
      close: async () => undefined
    };
    const connector = new HumanAssistSunoConnector(captchaInner(), {
      timeoutMs: Infinity,
      driverFactory: () => driver,
      notifier,
      workspaceRoot: root
    });
    // Kick off create; do not await yet — it blocks in waitForHumanSubmit.
    const createPromise = connector.create(request);

    await waitStarted;
    expect(await exists(markerPath)).toBe(true);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    expect(marker).toMatchObject({ songId: "song-1", runId: "run-1", pid: process.pid });
    expect(typeof marker.startedAt).toBe("string");

    releaseWait({ kind: "accepted", urls: ["https://suno.com/song/aaaaaaaaaaaaaaaa", "https://suno.com/song/bbbbbbbbbbbbbbbb"] });
    await createPromise;
    expect(await exists(markerPath)).toBe(false);
  });

  it("removes the marker even when the attempt throws", async () => {
    const root = makeRoot("artist-runtime-hap-throw-");
    const driver: HumanAssistBrowserDriver = {
      openAndFill: async () => {
        throw new Error("boom");
      },
      attemptMachineSubmit: async () => ({ kind: "captcha_challenge" }),
      closeChallengeOverlay: async () => undefined,
      bringToFront: async () => undefined,
      waitForHumanSubmit: async () => ({ kind: "timeout" }),
      close: async () => undefined
    };
    const connector = new HumanAssistSunoConnector(captchaInner(), {
      timeoutMs: 1000,
      driverFactory: () => driver,
      notifier,
      workspaceRoot: root
    });

    // openAndFill throwing is caught inside runHumanAssistCreate (returns an error
    // outcome, not a throw), but the connector's finally still runs.
    await connector.create(request);
    expect(await exists(humanAssistPendingPath(root))).toBe(false);
  });

  it("clears the marker when the wait rejects because the browser is gone", async () => {
    const root = makeRoot("artist-runtime-hap-gone-");
    const driver: HumanAssistBrowserDriver = {
      openAndFill: async () => undefined,
      attemptMachineSubmit: async () => ({ kind: "captcha_challenge" }),
      closeChallengeOverlay: async () => undefined,
      bringToFront: async () => undefined,
      // Mirrors CdpHumanAssistDriver rejecting once the producer closed the create tab.
      waitForHumanSubmit: async () => {
        throw new Error("human_assist_browser_gone");
      },
      close: async () => undefined
    };
    const connector = new HumanAssistSunoConnector(captchaInner(), {
      timeoutMs: Infinity,
      driverFactory: () => driver,
      notifier,
      workspaceRoot: root
    });

    const result = await connector.create(request);
    // Non-accepted so the autopilot re-drives; and the single-flight marker is cleared
    // so the next attempt is allowed rather than blocked forever.
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("human_assist_browser_gone");
    expect(await exists(humanAssistPendingPath(root))).toBe(false);
  });
});

describe("human-assist single-flight guard (evaluateSunoGenerationLimits)", () => {
  const config = applyConfigDefaults({
    music: { suno: { maxGenerationsPerDay: 10, monthlyGenerationBudget: 10, minMinutesBetweenCreates: 1 } }
  } as never);

  it("refuses a new attempt while a live same-pid marker is present", async () => {
    const root = makeRoot("artist-runtime-hap-hold-");
    await writeHumanAssistPending(root, {
      songId: "spawn_c10e1d",
      runId: "run-x",
      pid: process.pid,
      startedAt: new Date().toISOString()
    });

    const decision = await evaluateSunoGenerationLimits(root, config);
    expect(decision).toMatchObject({
      allowed: false,
      reason: "human_assist_pending:spawn_c10e1d",
      policyDecision: "stop_human_assist_pending"
    });
    // The hold does not delete a genuinely-active marker.
    expect(await exists(humanAssistPendingPath(root))).toBe(true);
  });

  it("allows the attempt when no marker exists", async () => {
    const root = makeRoot("artist-runtime-hap-none-");
    const decision = await evaluateSunoGenerationLimits(root, config);
    expect(decision).toBeUndefined();
  });

  it("deletes a stale (different/dead pid) marker and allows the attempt", async () => {
    const root = makeRoot("artist-runtime-hap-stale-");
    // A pid that is not this process — treated as stale regardless of liveness.
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(
      humanAssistPendingPath(root),
      JSON.stringify({ songId: "old-song", pid: 999999, startedAt: new Date().toISOString() }),
      "utf8"
    );

    const decision = await evaluateSunoGenerationLimits(root, config);
    expect(decision).toBeUndefined();
    expect(await exists(humanAssistPendingPath(root))).toBe(false);
  });

  it("treats an unparseable marker as stale", async () => {
    const root = makeRoot("artist-runtime-hap-bad-");
    await mkdir(join(root, "runtime", "suno"), { recursive: true });
    await writeFile(humanAssistPendingPath(root), "{not json", "utf8");
    expect(await evaluateHumanAssistPending(root)).toBeUndefined();
  });
});
