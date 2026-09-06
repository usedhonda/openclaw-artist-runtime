import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const healthcheckScript = resolve("scripts/linux/gateway-healthcheck.sh");

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((res) => activeServer!.close(() => res()));
    activeServer = undefined;
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
    const state = await readState(stateFile);
    expect(state.ok).toBe(true);
    expect(state.consecutiveFailures).toBe(0);
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
