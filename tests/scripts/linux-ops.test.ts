import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const healthcheckScript = resolve("scripts/linux/gateway-healthcheck.sh");
const healthcheckLoopScript = resolve("scripts/linux/gateway-healthcheck-loop.sh");

let activeServer: Server | undefined;
let activeLoopPid: number | undefined;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((res) => activeServer!.close(() => res()));
    activeServer = undefined;
  }
  // Safety net: if a loop-related assertion throws before the test's own
  // "stop" call runs, don't leak a detached background process.
  if (activeLoopPid !== undefined && isPidAlive(activeLoopPid)) {
    try {
      process.kill(activeLoopPid, "SIGKILL");
    } catch {
      // already gone
    }
    activeLoopPid = undefined;
  }
});

function startStubServer(statusCode: number): Promise<string> {
  return new Promise((resolvePromise) => {
    const server = createServer((_req, res) => {
      res.statusCode = statusCode;
      res.end("{}");
    });
    activeServer = server;
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise(`http://127.0.0.1:${port}/plugins/artist-runtime/api/status`);
    });
  });
}

async function writeHeartbeat(workspace: string, ageMs: number): Promise<void> {
  const dir = join(workspace, "runtime");
  await mkdir(dir, { recursive: true });
  const updatedAt = new Date(Date.now() - ageMs).toISOString();
  await writeFile(join(dir, "autopilot-heartbeat.json"), `${JSON.stringify({ updatedAt, pid: 4242 }, null, 2)}\n`, "utf8");
}

// Mirrors src/services/supervisorHealth.ts's SupervisorHeartbeat shape
// ("timestamp", not "updatedAt"), written every ~15s by
// scripts/openclaw-local-gateway-supervisor regardless of autopilot activity.
async function writeSupervisorHeartbeat(workspace: string, ageMs: number): Promise<void> {
  const dir = join(workspace, "runtime");
  await mkdir(dir, { recursive: true });
  const timestamp = new Date(Date.now() - ageMs).toISOString();
  await writeFile(
    join(dir, "supervisor-heartbeat.json"),
    `${JSON.stringify({ timestamp, pid: 9999, uptimeMs: ageMs, startedAt: timestamp, gateway: { state: "running" } }, null, 2)}\n`,
    "utf8"
  );
}

async function readState(stateFile: string): Promise<{ ok: boolean; consecutiveFailures: number; lastCheckedAt: string }> {
  return JSON.parse(await readFile(stateFile, "utf8"));
}

// Uses async spawn, not spawnSync: the stub HTTP server lives in this same
// test process, and spawnSync would block the event loop while the script's
// curl call waits on that very server, deadlocking both sides.
function runHealthcheck(env: Record<string, string | undefined>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("bash", [healthcheckScript], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

describe("scripts/linux/gateway-healthcheck.sh syntax", () => {
  it("passes bash -n syntax checking", () => {
    const result = spawnSync("bash", ["-n", healthcheckScript], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("gateway-healthcheck.sh", () => {
  it("reports ok and resets the failure count when the gateway is 200 and the heartbeat is fresh", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-"));
    await writeHeartbeat(workspace, 1_000);
    const gatewayUrl = await startStubServer(200);
    const stateFile = join(workspace, "runtime", "healthcheck-state.json");

    const result = await runHealthcheck({ GATEWAY_URL: gatewayUrl, WORKSPACE_ROOT: workspace, STATE_FILE: stateFile });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("] ok ");
    // No supervisor-heartbeat.json in this workspace, so the default
    // selection must fall back to the autopilot heartbeat.
    expect(result.stdout).toContain("heartbeat_file=autopilot-heartbeat.json");
    const state = await readState(stateFile);
    expect(state.ok).toBe(true);
    expect(state.consecutiveFailures).toBe(0);
  });

  it("prefers a fresh supervisor heartbeat over a stale autopilot heartbeat", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-"));
    await writeHeartbeat(workspace, 20 * 60 * 1_000); // stale: would fail HEARTBEAT_MAX_AGE_SEC=900 if used
    await writeSupervisorHeartbeat(workspace, 7_000); // fresh
    const gatewayUrl = await startStubServer(200);
    const stateFile = join(workspace, "runtime", "healthcheck-state.json");

    const result = await runHealthcheck({
      GATEWAY_URL: gatewayUrl,
      WORKSPACE_ROOT: workspace,
      STATE_FILE: stateFile,
      HEARTBEAT_MAX_AGE_SEC: "900"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("] ok ");
    expect(result.stdout).toContain("heartbeat_file=supervisor-heartbeat.json");
    const state = await readState(stateFile);
    expect(state.ok).toBe(true);
  });

  it("honors a HEARTBEAT_FILE override with an epoch-ms timestamp field, bypassing both defaults", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-"));
    await writeHeartbeat(workspace, 20 * 60 * 1_000); // stale autopilot default; must be ignored
    await writeSupervisorHeartbeat(workspace, 20 * 60 * 1_000); // stale supervisor default; must be ignored
    const overrideFile = join(workspace, "custom-heartbeat.json");
    await writeFile(overrideFile, `${JSON.stringify({ timestamp: Date.now() - 5_000 })}\n`, "utf8");
    const gatewayUrl = await startStubServer(200);
    const stateFile = join(workspace, "runtime", "healthcheck-state.json");

    const result = await runHealthcheck({
      GATEWAY_URL: gatewayUrl,
      WORKSPACE_ROOT: workspace,
      STATE_FILE: stateFile,
      HEARTBEAT_MAX_AGE_SEC: "900",
      HEARTBEAT_FILE: overrideFile
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("] ok ");
    expect(result.stdout).toContain("heartbeat_file=custom-heartbeat.json");
    const state = await readState(stateFile);
    expect(state.ok).toBe(true);
  });

  it("increments the failure count and logs fail on a non-200 response", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-"));
    await writeHeartbeat(workspace, 1_000);
    const gatewayUrl = await startStubServer(500);
    const stateFile = join(workspace, "runtime", "healthcheck-state.json");

    const result = await runHealthcheck({ GATEWAY_URL: gatewayUrl, WORKSPACE_ROOT: workspace, STATE_FILE: stateFile });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("] fail ");
    expect(result.stdout).toContain("http_status=500");
    const state = await readState(stateFile);
    expect(state.ok).toBe(false);
    expect(state.consecutiveFailures).toBe(1);
  });

  it("fails on a stale heartbeat even when the gateway responds 200", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-"));
    await writeHeartbeat(workspace, 20 * 60 * 1_000);
    const gatewayUrl = await startStubServer(200);
    const stateFile = join(workspace, "runtime", "healthcheck-state.json");

    const result = await runHealthcheck({
      GATEWAY_URL: gatewayUrl,
      WORKSPACE_ROOT: workspace,
      STATE_FILE: stateFile,
      HEARTBEAT_MAX_AGE_SEC: "900"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("] fail ");
    expect(result.stdout).toContain("heartbeat_age_sec=");
    const state = await readState(stateFile);
    expect(state.ok).toBe(false);
  });

  it("fails when the heartbeat file is missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-"));
    await mkdir(join(workspace, "runtime"), { recursive: true });
    const gatewayUrl = await startStubServer(200);
    const stateFile = join(workspace, "runtime", "healthcheck-state.json");

    const result = await runHealthcheck({ GATEWAY_URL: gatewayUrl, WORKSPACE_ROOT: workspace, STATE_FILE: stateFile });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("heartbeat_age_sec=missing");
    const state = await readState(stateFile);
    expect(state.ok).toBe(false);
  });

  it("invokes NOTIFY_CMD once the consecutive-failure threshold is reached, and again on recovery", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-"));
    await writeHeartbeat(workspace, 1_000);
    const stateFile = join(workspace, "runtime", "healthcheck-state.json");
    const notifyLog = join(workspace, "notify.log");
    const notifyScript = join(workspace, "notify.sh");
    await writeFile(notifyScript, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${notifyLog}'\n`, "utf8");
    await chmod(notifyScript, 0o755);

    const failingUrl = await startStubServer(500);
    const baseEnv = {
      WORKSPACE_ROOT: workspace,
      STATE_FILE: stateFile,
      FAIL_THRESHOLD: "2",
      NOTIFY_CMD: notifyScript
    };

    await runHealthcheck({ ...baseEnv, GATEWAY_URL: failingUrl }); // failure 1: below threshold
    let notifyContents = await readFile(notifyLog, "utf8").catch(() => "");
    expect(notifyContents).toBe("");

    const secondFailure = await runHealthcheck({ ...baseEnv, GATEWAY_URL: failingUrl }); // failure 2: hits threshold
    expect(secondFailure.status).toBe(0);
    notifyContents = await readFile(notifyLog, "utf8").catch(() => "");
    expect(notifyContents).toContain("gateway healthcheck failing");

    await new Promise<void>((res) => activeServer!.close(() => res()));
    const recoveredUrl = await startStubServer(200);
    const recovered = await runHealthcheck({ ...baseEnv, GATEWAY_URL: recoveredUrl });
    expect(recovered.status).toBe(0);
    notifyContents = await readFile(notifyLog, "utf8").catch(() => "");
    expect(notifyContents).toContain("gateway healthcheck recovered");
  });
});

describe("scripts/linux/gateway-healthcheck-loop.sh syntax", () => {
  it("passes bash -n syntax checking", () => {
    const result = spawnSync("bash", ["-n", healthcheckLoopScript], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("gateway-healthcheck-loop.sh", () => {
  it("starts a singleton detached loop, refuses a second start, and stops cleanly", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-loop-"));
    await writeHeartbeat(workspace, 1_000);
    const gatewayUrl = await startStubServer(200);
    const logDir = join(workspace, "logs");
    const pidFile = join(logDir, "healthcheck-loop.pid");

    const env = {
      ...process.env,
      GATEWAY_URL: gatewayUrl,
      WORKSPACE_ROOT: workspace,
      STATE_FILE: join(workspace, "runtime", "healthcheck-state.json"),
      HEALTHCHECK_LOOP_LOG_DIR: logDir,
      HEALTHCHECK_INTERVAL_SEC: "1"
    };

    const start = spawnSync("bash", [healthcheckLoopScript, "start"], { env, encoding: "utf8" });
    expect(start.status, start.stderr).toBe(0);

    const pid = Number((await readFile(pidFile, "utf8")).trim());
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    activeLoopPid = pid;
    expect(isPidAlive(pid)).toBe(true);

    const statusAfterStart = spawnSync("bash", [healthcheckLoopScript, "status"], { env, encoding: "utf8" });
    expect(statusAfterStart.status).toBe(0);
    expect(statusAfterStart.stdout).toContain(`pid=${pid}`);
    expect(statusAfterStart.stdout).toContain("alive=true");

    // Second start must refuse to spawn a competing instance.
    const secondStart = spawnSync("bash", [healthcheckLoopScript, "start"], { env, encoding: "utf8" });
    expect(secondStart.status).toBe(0);
    expect(secondStart.stderr).toContain("already running");
    const pidAfterSecondStart = (await readFile(pidFile, "utf8")).trim();
    expect(pidAfterSecondStart).toBe(String(pid));

    // Let at least one interval tick land in the log before stopping.
    await new Promise((res) => setTimeout(res, 1_500));
    const logContents = await readFile(join(logDir, "healthcheck.log"), "utf8");
    expect(logContents).toMatch(/\] (ok|fail) /);

    const stop = spawnSync("bash", [healthcheckLoopScript, "stop"], { env, encoding: "utf8" });
    expect(stop.status, stop.stderr).toBe(0);
    activeLoopPid = undefined;
    expect(isPidAlive(pid)).toBe(false);

    const statusAfterStop = spawnSync("bash", [healthcheckLoopScript, "status"], { env, encoding: "utf8" });
    expect(statusAfterStop.stdout).toContain("pid=stopped");
    expect(statusAfterStop.stdout).toContain("alive=false");
  }, 15_000);

  it("runs one healthcheck in the foreground for run-once", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artist-runtime-healthcheck-loop-"));
    await writeHeartbeat(workspace, 1_000);
    const gatewayUrl = await startStubServer(200);
    const stateFile = join(workspace, "runtime", "healthcheck-state.json");

    // Async spawn, not spawnSync: run-once shells out to curl against the
    // stub server living in this same process, and spawnSync would freeze
    // this process's event loop while curl waits on it (see the
    // runHealthcheck comment above).
    const result = await new Promise<{ status: number | null; stdout: string }>((resolvePromise, reject) => {
      const child = spawn("bash", [healthcheckLoopScript, "run-once"], {
        env: {
          ...process.env,
          GATEWAY_URL: gatewayUrl,
          WORKSPACE_ROOT: workspace,
          STATE_FILE: stateFile,
          HEALTHCHECK_LOOP_LOG_DIR: join(workspace, "logs")
        }
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.on("error", reject);
      child.on("close", (status) => resolvePromise({ status, stdout }));
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("] ok ");
    const state = await readState(stateFile);
    expect(state.ok).toBe(true);
  });
});
