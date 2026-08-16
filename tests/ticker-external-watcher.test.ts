import { createServer, type IncomingMessage } from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-ticker-watcher-"));
}

async function writeAutopilotHeartbeat(root: string, pid: number): Promise<void> {
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "runtime", "autopilot-heartbeat.json"), JSON.stringify({
    updatedAt: "2026-05-28T00:00:00.000Z",
    pid,
    lastTickAttempt: "2026-05-28T00:00:00.000Z",
    lastTickResult: "ran",
    currentStage: "planning"
  }), "utf8");
}

async function writeFreshAutopilotHeartbeat(root: string, pid: number): Promise<void> {
  const now = new Date().toISOString();
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "runtime", "autopilot-heartbeat.json"), JSON.stringify({
    updatedAt: now,
    pid,
    lastTickAttempt: now,
    lastTickResult: "ran",
    currentStage: "suno_generation"
  }), "utf8");
}

async function writeSupervisorHeartbeat(root: string, supervisorPid: number, gatewayPid: number): Promise<void> {
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(join(root, "runtime", "supervisor-heartbeat.json"), JSON.stringify({
    timestamp: new Date().toISOString(),
    pid: supervisorPid,
    uptimeMs: 1,
    startedAt: new Date().toISOString(),
    gateway: {
      state: "running",
      pid: gatewayPid,
      startedAt: new Date().toISOString(),
      uptimeMs: 1
    }
  }), "utf8");
}

async function exitedProcessPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (typeof pid !== "number") {
    throw new Error("test child pid unavailable");
  }
  await once(child, "exit");
  return pid;
}

interface TelegramStub {
  base: string;
  requests: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

async function telegramStub(): Promise<TelegramStub> {
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer(async (req, res) => {
    requests.push(await readRequestJson(req));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("telegram stub did not bind to a TCP port");
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function readRequestJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function runWatcher(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync("scripts/openclaw-ticker-watcher", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe("ticker external watcher", () => {
  it("triggers the safe tick endpoint when the ticker heartbeat is stale and the gateway process is alive", async () => {
    const root = workspace();
    await writeAutopilotHeartbeat(root, process.pid);
    await writeSupervisorHeartbeat(root, process.pid, process.pid);
    let body: Record<string, unknown> | undefined;
    const server = createServer(async (req, res) => {
      body = await readRequestJson(req);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ triggered: true, statusCode: 200, tickerOutcome: "ran" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind to a TCP port");
    }

    try {
      const result = await runWatcher([
        "--once",
        "--workspace",
        root,
        "--gateway-url",
        `http://127.0.0.1:${address.port}`,
        "--supervisor",
        "scripts/openclaw-local-gateway-supervisor",
        "--stale-ms",
        "1",
        "--token",
        "secret"
      ]);

      expect(result).toMatchObject({ action: "safe_tick_trigger", reason: "ticker_stale_gateway_alive" });
      expect(body).toEqual({ token: "secret" });
      expect(await readFile(join(root, "runtime", "ticker-watcher.log"), "utf8")).toContain("safe tick trigger");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("uses the live supervisor-owned gateway when the recorded ticker writer has exited", async () => {
    const root = workspace();
    const deadWriterPid = await exitedProcessPid();
    await writeAutopilotHeartbeat(root, deadWriterPid);
    await writeSupervisorHeartbeat(root, process.pid, process.pid);
    let body: Record<string, unknown> | undefined;
    const server = createServer(async (req, res) => {
      body = await readRequestJson(req);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ triggered: true, statusCode: 200, tickerOutcome: "ran" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind to a TCP port");
    }

    try {
      const result = await runWatcher([
        "--once",
        "--workspace",
        root,
        "--gateway-url",
        `http://127.0.0.1:${address.port}`,
        "--supervisor",
        "scripts/openclaw-local-gateway-supervisor",
        "--stale-ms",
        "1",
        "--token",
        "secret"
      ]);

      expect(result).toMatchObject({ action: "safe_tick_trigger", reason: "ticker_stale_gateway_alive" });
      expect(body).toEqual({ token: "secret" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects a fresh heartbeat written by a process other than the supervisor-owned gateway", async () => {
    const root = workspace();
    const orphan = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" });
    const orphanPid = orphan.pid;
    if (typeof orphanPid !== "number") {
      throw new Error("test orphan pid unavailable");
    }
    await writeFreshAutopilotHeartbeat(root, orphanPid);
    await writeSupervisorHeartbeat(root, process.pid, process.pid);
    let body: Record<string, unknown> | undefined;
    const server = createServer(async (req, res) => {
      body = await readRequestJson(req);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ triggered: true, statusCode: 200, tickerOutcome: "ran" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind to a TCP port");
    }

    try {
      const result = await runWatcher([
        "--once",
        "--workspace",
        root,
        "--gateway-url",
        `http://127.0.0.1:${address.port}`,
        "--supervisor",
        "scripts/openclaw-local-gateway-supervisor",
        "--stale-ms",
        "600000",
        "--token",
        "secret"
      ]);

      expect(result).toMatchObject({ action: "safe_tick_trigger", reason: "ticker_stale_gateway_alive" });
      expect(body).toEqual({ token: "secret" });
    } finally {
      orphan.kill("SIGTERM");
      await Promise.all([
        once(orphan, "exit"),
        new Promise<void>((resolve) => server.close(() => resolve()))
      ]);
    }
  });

  it("escalates a prolonged supervisor wait exactly once", async () => {
    const root = workspace();
    const deadGatewayPid = await exitedProcessPid();
    await writeAutopilotHeartbeat(root, deadGatewayPid);
    await writeSupervisorHeartbeat(root, process.pid, deadGatewayPid);
    const watcher = spawn("scripts/openclaw-ticker-watcher", [
      "--workspace",
      root,
      "--gateway-url",
      "http://127.0.0.1:9",
      "--supervisor",
      "scripts/openclaw-local-gateway-supervisor",
      "--interval-ms",
      "10",
      "--supervisor-wait-limit-ms",
      "20"
    ], {
      cwd: process.cwd(),
      stdio: "ignore"
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    watcher.kill("SIGTERM");
    await once(watcher, "exit");

    const log = await readFile(join(root, "runtime", "ticker-watcher.log"), "utf8");
    expect(log.match(/escalation supervisor wait exceeded/g)).toHaveLength(1);
    const tombstone = JSON.parse(await readFile(join(root, "runtime", "ticker-watcher-escalation.json"), "utf8")) as Record<string, unknown>;
    expect(tombstone).toMatchObject({ type: "ticker_watcher_supervisor_wait_exceeded" });
  });

  it("sends exactly one Telegram notice when the supervisor-wait escalation tombstone is created", async () => {
    const root = workspace();
    const deadGatewayPid = await exitedProcessPid();
    await writeAutopilotHeartbeat(root, deadGatewayPid);
    await writeSupervisorHeartbeat(root, process.pid, deadGatewayPid);
    const telegram = await telegramStub();
    const watcher = spawn("scripts/openclaw-ticker-watcher", [
      "--workspace",
      root,
      "--gateway-url",
      "http://127.0.0.1:9",
      "--supervisor",
      "scripts/openclaw-local-gateway-supervisor",
      "--interval-ms",
      "10",
      "--supervisor-wait-limit-ms",
      "20",
      "--telegram-api-base",
      telegram.base
    ], {
      cwd: process.cwd(),
      stdio: "ignore",
      env: { ...process.env, TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_OWNER_USER_IDS: "123" }
    });

    try {
      await waitFor(() => telegram.requests.length >= 1, 2000);
      await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
      watcher.kill("SIGTERM");
      await once(watcher, "exit");
      await telegram.close();
    }

    expect(telegram.requests).toHaveLength(1);
    expect(telegram.requests[0]).toMatchObject({ chat_id: "123" });
    expect(String(telegram.requests[0].text)).toContain("supervisor_wait_exceeded");
    const log = await readFile(join(root, "runtime", "ticker-watcher.log"), "utf8");
    expect(log.match(/telegram notice sent/g)).toHaveLength(1);
  });

  it("sends the safe-tick delivery Telegram notice only on the third consecutive failure, once", async () => {
    const root = workspace();
    await writeAutopilotHeartbeat(root, process.pid);
    await writeSupervisorHeartbeat(root, process.pid, process.pid);
    const telegram = await telegramStub();
    const watcher = spawn("scripts/openclaw-ticker-watcher", [
      "--workspace",
      root,
      "--gateway-url",
      "http://127.0.0.1:9",
      "--supervisor",
      "scripts/openclaw-local-gateway-supervisor",
      "--interval-ms",
      "10",
      "--stale-ms",
      "1",
      "--safe-tick-rate-limit-ms",
      "1",
      "--telegram-api-base",
      telegram.base
    ], {
      cwd: process.cwd(),
      stdio: "ignore",
      env: {
        ...process.env,
        OPENCLAW_SAFE_TICK_TRIGGER_TOKEN: "safe-tick-secret",
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_OWNER_USER_IDS: "123"
      }
    });

    try {
      await waitFor(() => telegram.requests.length >= 1, 2000);
      await new Promise((resolve) => setTimeout(resolve, 120));
    } finally {
      watcher.kill("SIGTERM");
      await once(watcher, "exit");
      await telegram.close();
    }

    expect(telegram.requests).toHaveLength(1);
    expect(telegram.requests[0]).toMatchObject({ chat_id: "123" });
    expect(String(telegram.requests[0].text)).toContain("safe_tick_delivery_failed");
    expect(String(telegram.requests[0].text)).toContain("consecutiveFailures=3");
  });

  it("skips the Telegram notice silently when no bot token is resolvable and leaves the decision unchanged", async () => {
    const root = workspace();
    const deadGatewayPid = await exitedProcessPid();
    await writeAutopilotHeartbeat(root, deadGatewayPid);
    await writeSupervisorHeartbeat(root, process.pid, deadGatewayPid);
    const env = { ...process.env };
    delete env.TELEGRAM_BOT_TOKEN;
    delete env.TELEGRAM_OWNER_USER_IDS;
    const watcher = spawn("scripts/openclaw-ticker-watcher", [
      "--workspace",
      root,
      "--gateway-url",
      "http://127.0.0.1:9",
      "--supervisor",
      "scripts/openclaw-local-gateway-supervisor",
      "--interval-ms",
      "10",
      "--supervisor-wait-limit-ms",
      "20"
    ], {
      cwd: process.cwd(),
      stdio: "ignore",
      env
    });

    try {
      await waitFor(async () => {
        const current = await readFile(join(root, "runtime", "ticker-watcher.log"), "utf8").catch(() => "");
        return current.includes("telegram notice skipped token_missing");
      }, 2000);
      await new Promise((resolve) => setTimeout(resolve, 60));
    } finally {
      watcher.kill("SIGTERM");
      await once(watcher, "exit");
    }

    const log = await readFile(join(root, "runtime", "ticker-watcher.log"), "utf8");
    // Decision unchanged: the escalation tombstone is still created and logged.
    expect(log).toContain("escalation supervisor wait exceeded");
    expect(log).toContain("telegram notice skipped token_missing");
    expect(log).not.toContain("telegram notice sent");
    const tombstone = JSON.parse(await readFile(join(root, "runtime", "ticker-watcher-escalation.json"), "utf8")) as Record<string, unknown>;
    expect(tombstone).toMatchObject({ type: "ticker_watcher_supervisor_wait_exceeded" });
  });

  it("respawns the supervisor when stale ticker heartbeat points to a dead gateway and supervisor heartbeat is absent", async () => {
    const root = workspace();
    await writeAutopilotHeartbeat(root, 999_999_999);
    const supervisor = join(root, "fake-supervisor.sh");
    await writeFile(supervisor, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(supervisor, 0o755);

    const result = await runWatcher([
      "--once",
      "--workspace",
      root,
      "--gateway-url",
      "http://127.0.0.1:9",
      "--supervisor",
      supervisor,
      "--stale-ms",
      "1",
    ]);

    expect(result).toMatchObject({ action: "supervisor_restart", reason: "supervisor_heartbeat_unavailable" });
    expect(typeof result.pid).toBe("number");
    expect(await readFile(join(root, "runtime", "ticker-watcher.log"), "utf8")).toContain("spawned supervisor");
  });
});
