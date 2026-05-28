#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const STARTUP_CRASH_MS = 60_000;

function usage() {
  console.error("usage: openclaw-supervisor-health.mjs <heartbeat|crash-evidence|watch-supervisor> ...");
  process.exit(2);
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return fallback;
  }
  return args[index + 1];
}

function numberArg(args, name, fallback) {
  const raw = argValue(args, name, undefined);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function classifyGatewayExit({ rc, startedAtMs, exitedAtMs, tailLines }) {
  if (rc === 0) {
    return "clean_exit";
  }
  if (rc >= 128) {
    return "signal_exit";
  }
  const uptimeMs = Math.max(0, exitedAtMs - startedAtMs);
  if (uptimeMs <= STARTUP_CRASH_MS) {
    return "startup_crash";
  }
  if (/(?:autopilot|ticker|run-cycle|runCycle|cycle)/i.test(tailLines.join("\n"))) {
    return "tick_after_crash";
  }
  return "runtime_crash";
}

async function tailFile(path, lines) {
  const text = await readFile(path, "utf8").catch(() => "");
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/).slice(-lines).filter(Boolean);
}

async function heartbeat(args) {
  const workspace = argValue(args, "--workspace");
  if (!workspace) {
    usage();
  }
  const now = Date.now();
  const startedAtMs = numberArg(args, "--started-at-ms", now);
  const pid = numberArg(args, "--pid", process.pid);
  await writeJson(join(workspace, "runtime", "supervisor-heartbeat.json"), {
    timestamp: new Date(now).toISOString(),
    pid,
    uptimeMs: Math.max(0, now - startedAtMs),
    startedAt: new Date(startedAtMs).toISOString()
  });
}

async function crashEvidence(args) {
  const workspace = argValue(args, "--workspace");
  const logPath = argValue(args, "--log");
  if (!workspace) {
    usage();
  }
  const pid = numberArg(args, "--pid", 0);
  const rc = numberArg(args, "--rc", 0);
  const startedAtMs = numberArg(args, "--started-at-ms", Date.now());
  const exitedAtMs = numberArg(args, "--exited-at-ms", Date.now());
  const tailLines = logPath ? await tailFile(logPath, numberArg(args, "--tail-lines", 400)) : [];
  const evidence = {
    timestamp: new Date(exitedAtMs).toISOString(),
    pid,
    rc,
    uptimeMs: Math.max(0, exitedAtMs - startedAtMs),
    exitContext: classifyGatewayExit({ rc, startedAtMs, exitedAtMs, tailLines }),
    tailLines
  };
  const dir = join(workspace, "runtime", "crash-evidence");
  const file = `gateway-exit-${new Date(exitedAtMs).toISOString().replace(/[:.]/g, "-")}-${pid}.json`;
  await writeJson(join(dir, file), evidence);
  await appendFile(join(dir, "gateway-exits.jsonl"), `${JSON.stringify({ ...evidence, file })}\n`, "utf8");
  console.log(`${evidence.exitContext} ${join(dir, file)}`);
}

async function readHeartbeat(path) {
  return readFile(path, "utf8").then((text) => JSON.parse(text)).catch(() => undefined);
}

async function watchSupervisor(args) {
  const workspace = argValue(args, "--workspace");
  const supervisor = argValue(args, "--supervisor");
  if (!workspace || !supervisor) {
    usage();
  }
  const staleMs = numberArg(args, "--stale-ms", 60_000);
  const intervalMs = numberArg(args, "--interval-ms", 15_000);
  const logPath = argValue(args, "--log", join(workspace, "runtime", "supervisor-watchdog.log"));
  const separator = args.indexOf("--");
  const supervisorArgs = separator === -1 ? [] : args.slice(separator + 1);
  const heartbeatPath = join(workspace, "runtime", "supervisor-heartbeat.json");
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `[watcher ${new Date().toISOString()}] started pid=${process.pid} supervisor=${supervisor}\n`);

  let child;
  function heartbeatIsStale(heartbeatState) {
    const timestamp = Date.parse(heartbeatState?.timestamp ?? "");
    return !Number.isFinite(timestamp) || Date.now() - timestamp > staleMs;
  }
  function spawnSupervisor(reason, force = false) {
    if (child && child.exitCode === null && child.signalCode === null) {
      if (!force) {
        return;
      }
      child.kill("TERM");
    }
    if (force || !child || child.exitCode !== null || child.signalCode !== null) {
      child = undefined;
    }
    if (child) {
      return;
    }
    child = spawn(resolve(supervisor), supervisorArgs, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    void appendFile(logPath, `[watcher ${new Date().toISOString()}] spawned supervisor pid=${child.pid} reason=${reason}\n`);
  }

  if (heartbeatIsStale(await readHeartbeat(heartbeatPath))) {
    spawnSupervisor("initial");
  } else {
    await appendFile(logPath, `[watcher ${new Date().toISOString()}] heartbeat fresh; initial spawn skipped\n`);
  }
  setInterval(async () => {
    const heartbeatState = await readHeartbeat(heartbeatPath);
    if (heartbeatIsStale(heartbeatState)) {
      await appendFile(logPath, `[watcher ${new Date().toISOString()}] stale heartbeat; respawn\n`);
      spawnSupervisor("stale_heartbeat", true);
    }
  }, intervalMs);
}

const [command, ...args] = process.argv.slice(2);
if (command === "heartbeat") {
  await heartbeat(args);
} else if (command === "crash-evidence") {
  await crashEvidence(args);
} else if (command === "watch-supervisor") {
  await watchSupervisor(args);
} else {
  usage();
}
