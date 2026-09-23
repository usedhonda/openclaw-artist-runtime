import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInProcessGateway } from "../harness/inProcessGateway.js";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

interface SpawnStep {
  code?: number | null;
  stdout?: string;
  stderr?: string;
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function createSpawnMock(steps: SpawnStep[]) {
  let index = 0;
  return () => {
    const step = steps[index++];
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (!step) {
        child.emit("close", 1);
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
  };
}

describe("gateway X probe config chain", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("boots routes, probes X, persists auth status, and reloads persisted config", async () => {
    const gateway = await createInProcessGateway();
    spawnMock.mockImplementation(createSpawnMock([
      { code: 0, stdout: "bird help" },
      { code: 0, stdout: "@test_artist (test::artist)" }
    ]));

    try {
      const probe = await gateway.request<{
        platform: "x";
        status: { connected: boolean; authStatus?: string; lastTestedAt?: number; accountLabel?: string };
      }>("POST", "/plugins/artist-runtime/api/platforms/x/test");

      expect(probe.statusCode).toBe(200);
      expect(probe.body.platform).toBe("x");
      expect(probe.body.status.connected).toBe(true);
      expect(probe.body.status.authStatus).toBe("tested");
      expect(probe.body.status.lastTestedAt).toBeTypeOf("number");
      expect(probe.body.status.accountLabel).toContain("@test_artist");

      const overridePath = join(gateway.workspaceRoot, "runtime", "config-overrides.json");
      const override = JSON.parse(await readFile(overridePath, "utf8")) as {
        distribution?: { platforms?: { x?: { authStatus?: string; lastTestedAt?: number } } };
      };
      expect(override.distribution?.platforms?.x?.authStatus).toBe("tested");
      expect(override.distribution?.platforms?.x?.lastTestedAt).toBe(probe.body.status.lastTestedAt);

      const reloaded = await createInProcessGateway({ workspaceRoot: gateway.workspaceRoot });
      const config = await reloaded.request<{ distribution: { platforms: { x: { authStatus?: string; lastTestedAt?: number } } } }>(
        "GET",
        "/plugins/artist-runtime/api/config"
      );
      expect(config.body.distribution.platforms.x.authStatus).toBe("tested");
      expect(config.body.distribution.platforms.x.lastTestedAt).toBe(probe.body.status.lastTestedAt);
    } finally {
      await gateway.teardown();
    }
  }, 30_000);
});
