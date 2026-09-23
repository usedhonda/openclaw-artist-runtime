import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAlertsResponse } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { SunoBrowserWorker, type SunoBrowserDriver } from "../src/services/sunoBrowserWorker";

function createDriver(state: Awaited<ReturnType<SunoBrowserDriver["probe"]>>["state"], detail?: string): SunoBrowserDriver {
  return {
    async probe() {
      return { state, detail };
    },
    async stop() {
      return;
    }
  };
}

describe("SunoBrowserWorker lifecycle", () => {
  it("persists a connected state after a successful start probe", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-start-"));
    const worker = new SunoBrowserWorker(root);

    const started = await worker.start({
      driver: createDriver("connected")
    });
    const persisted = await new SunoBrowserWorker(root).status();

    expect(started.state).toBe("connected");
    expect(started.connected).toBe(true);
    expect(started.pendingAction).toBeUndefined();
    expect(started.loginHandoff).toBeUndefined();
    expect(persisted.state).toBe("connected");
  });

  it("enters login_required and surfaces an operator alert when login handoff is needed", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-login-"));
    await ensureArtistWorkspace(root);
    const worker = new SunoBrowserWorker(root);

    const started = await worker.start();
    const alerts = await buildAlertsResponse({ artist: { workspaceRoot: root } });

    expect(started.state).toBe("login_required");
    expect(started.connected).toBe(false);
    expect(started.pendingAction).toBe("operator_login_required");
    expect(started.hardStopReason).toContain("Suno login required");
    expect(started.loginHandoff).toMatchObject({
      state: "waiting_for_operator",
      reason: "operator_login_required"
    });
    expect(alerts.some((alert) => alert.source === "suno_worker" && alert.message.includes("Suno login required"))).toBe(true);
  });

  it("records hard-stop probes and increments failure count", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-captcha-"));
    const worker = new SunoBrowserWorker(root);

    const started = await worker.start({
      driver: createDriver("captcha", "Suno CAPTCHA wall")
    });

    expect(started.state).toBe("captcha");
    expect(started.connected).toBe(false);
    expect(started.failureCount).toBe(1);
    expect(started.hardStopReason).toBe("Suno CAPTCHA wall");
    expect(started.loginHandoff).toMatchObject({
      state: "waiting_for_operator",
      reason: "captcha"
    });
  });

  it("marks the manual login handoff complete and returns to connected", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-complete-"));
    const worker = new SunoBrowserWorker(root);

    await worker.start();
    const resumed = await worker.completeManualLoginHandoff();

    expect(resumed.state).toBe("connected");
    expect(resumed.connected).toBe(true);
    expect(resumed.hardStopReason).toBeUndefined();
    expect(resumed.loginHandoff).toMatchObject({
      state: "completed",
      reason: "operator_login_required"
    });
    expect(resumed.loginHandoff?.completedAt).toBeTruthy();
  });

  it("stops idempotently and keeps the stopped state persisted", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-stop-"));
    const worker = new SunoBrowserWorker(root);

    await worker.start({
      driver: createDriver("connected")
    });
    const stopped = await worker.stop();
    const stoppedAgain = await worker.stop();
    const persisted = await new SunoBrowserWorker(root).status();

    expect(stopped.state).toBe("stopped");
    expect(stopped.connected).toBe(false);
    expect(stoppedAgain.state).toBe("stopped");
    expect(persisted.state).toBe("stopped");
  });
});
