import { createServer, type IncomingMessage } from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
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

    expect(result).toMatchObject({ action: "supervisor_restart", reason: "gateway_dead_supervisor_dead" });
    expect(typeof result.pid).toBe("number");
    expect(await readFile(join(root, "runtime", "ticker-watcher.log"), "utf8")).toContain("spawned supervisor");
  });
});
