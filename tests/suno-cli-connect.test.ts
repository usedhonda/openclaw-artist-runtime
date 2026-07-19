import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SunoBrowserWorker } from "../src/services/sunoBrowserWorker";
import type { SunoBrowserDriver, SunoBrowserDriverProbe } from "../src/services/sunoBrowserWorker";
import { sunoBrowserService } from "../src/services/sunoBrowserService";

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-suno-cli-connect-"));
}

function cliConfig() {
  return { music: { suno: { driver: "suno_cli" as const } } };
}

function mockDriver(outcome: SunoBrowserDriverProbe | { throws: true }): SunoBrowserDriver & { stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(async () => undefined);
  return {
    probe: vi.fn(async () => {
      if ("throws" in outcome) {
        throw new Error("probe boom");
      }
      return outcome;
    }),
    stop
  };
}

describe("suno_cli Console connect flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds the browser open (no release) and reports login_required", async () => {
    const driver = mockDriver({ state: "login_required", detail: "log in" });
    const worker = new SunoBrowserWorker(tmpRoot(), { config: cliConfig(), connectDriver: driver });

    const status = await worker.connect();

    expect(status.state).toBe("login_required");
    expect(driver.probe).toHaveBeenCalledTimes(1);
    expect(driver.stop).not.toHaveBeenCalled();
    expect(status.loginHandoff?.state).toBe("waiting_for_operator");
  });

  it("releases the browser and marks connected when the probe already sees a session", async () => {
    const driver = mockDriver({ state: "connected" });
    const worker = new SunoBrowserWorker(tmpRoot(), { config: cliConfig(), connectDriver: driver });

    const status = await worker.connect();

    expect(status.state).toBe("connected");
    expect(status.connected).toBe(true);
    expect(driver.stop).toHaveBeenCalledTimes(1);
  });

  it("releases the browser and falls to disconnected when the probe throws", async () => {
    const driver = mockDriver({ throws: true });
    const worker = new SunoBrowserWorker(tmpRoot(), { config: cliConfig(), connectDriver: driver });

    const status = await worker.connect();

    expect(status.state).toBe("disconnected");
    expect(driver.stop).toHaveBeenCalledTimes(1);
  });

  it("reconnect carries the reconnect_requested action", async () => {
    const driver = mockDriver({ state: "login_required" });
    const worker = new SunoBrowserWorker(tmpRoot(), { config: cliConfig(), connectDriver: driver });

    const status = await worker.reconnect();

    expect(status.state).toBe("login_required");
    expect(status.pendingAction).toBe("reconnect_requested");
  });

  it("closes the operator session and marks connected on handoff completion", async () => {
    const closeSpy = vi.spyOn(sunoBrowserService, "closeOperatorSession").mockResolvedValue(undefined);
    const worker = new SunoBrowserWorker(tmpRoot(), { config: cliConfig() });

    const status = await worker.completeManualLoginHandoff();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(status.state).toBe("connected");
    expect(status.connected).toBe(true);
  });

  it("does not probe/launch for a non-suno_cli lane connect (legacy setState)", async () => {
    const driver = mockDriver({ state: "connected" });
    const worker = new SunoBrowserWorker(tmpRoot(), {
      config: { music: { suno: { driver: "playwright" as const } } },
      connectDriver: driver
    });

    const status = await worker.connect();

    expect(status.state).toBe("disconnected");
    expect(status.pendingAction).toBe("operator_login_required");
    expect(driver.probe).not.toHaveBeenCalled();
  });

  it("status() never probes/launches (boot read-only)", async () => {
    const driver = mockDriver({ state: "connected" });
    const worker = new SunoBrowserWorker(tmpRoot(), { config: cliConfig(), connectDriver: driver });

    await worker.status();

    expect(driver.probe).not.toHaveBeenCalled();
    expect(driver.stop).not.toHaveBeenCalled();
  });
});
