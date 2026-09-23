import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { XBirdConnector } from "../src/connectors/social/xBirdConnector";

interface SpawnStep {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  errorCode?: string;
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function createSpawnMock(steps: SpawnStep[]) {
  const calls: Array<{ command: string; args: string[] }> = [];
  let index = 0;
  const spawnMock = ((command: string, args: string[]) => {
    calls.push({ command, args });
    const step = steps[index++];
    const child = new FakeChildProcess();

    queueMicrotask(() => {
      if (!step) {
        child.emit("close", 1);
        return;
      }
      if (step.errorCode) {
        const error = new Error(step.errorCode) as NodeJS.ErrnoException;
        error.code = step.errorCode;
        child.emit("error", error);
        return;
      }
      if (step.stdout) {
        child.stdout.emit("data", step.stdout);
      }
      if (step.stderr) {
        child.stderr.emit("data", step.stderr);
      }
      child.emit("close", step.code ?? 0);
    });

    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  return { spawnMock, calls };
}

describe("XBirdConnector dry-run E2E", () => {
  it("runs auth, compose, and dry-run submit stages without accepting a live publish", async () => {
    const { spawnMock, calls } = createSpawnMock([
      { code: 0, stdout: "@ghost_station" },
      { code: 0, stdout: "composed" },
      { code: 0, stdout: "dry-run tweet ok" }
    ]);
    const connector = new XBirdConnector(spawnMock, { dryRunStageExecution: true });

    await expect(connector.publish({
      dryRun: true,
      authority: "auto_publish",
      postType: "observation",
      text: "static over the empty port"
    })).resolves.toMatchObject({
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: "dry-run blocks publish",
      raw: {
        accountLabel: "@ghost_station",
        stageOrder: ["auth_check", "compose", "submit"],
        submitPreview: "dry-run tweet ok"
      }
    });

    expect(calls.map((call) => call.args)).toEqual([
      ["whoami", "--plain"],
      ["--plain", "compose", "static over the empty port"],
      ["--plain", "tweet", "--dry-run", "static over the empty port"]
    ]);
  });

  it("fails closed when the dry-run auth stage reports expired Bird credentials", async () => {
    const { spawnMock, calls } = createSpawnMock([
      { code: 1, stderr: "401 Unauthorized: Could not authenticate" }
    ]);
    const connector = new XBirdConnector(spawnMock, { dryRunStageExecution: true });

    await expect(connector.publish({
      dryRun: true,
      authority: "auto_publish",
      postType: "observation",
      text: "no signal"
    })).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: "bird_auth_expired"
    });
    expect(calls).toHaveLength(1);
  });

  it("rejects live mode before any Bird command can run", async () => {
    const { spawnMock, calls } = createSpawnMock([]);
    const connector = new XBirdConnector(spawnMock, { dryRunStageExecution: true });

    await expect(connector.publish({
      dryRun: false,
      authority: "auto_publish",
      postType: "observation",
      text: "do not publish"
    })).resolves.toEqual({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
    expect(calls).toHaveLength(0);
  });
});
