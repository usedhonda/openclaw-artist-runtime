import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SupervisorHeartbeat {
  timestamp: string;
  pid: number;
  uptimeMs: number;
  startedAt: string;
}

export interface AutopilotHeartbeat {
  updatedAt: string;
  pid: number;
  lastTickAttempt?: string;
  lastTickResult?: string;
  currentStage?: string;
}

export type GatewayExitContext = "clean_exit" | "signal_exit" | "startup_crash" | "tick_after_crash" | "runtime_crash";

export interface GatewayCrashEvidenceInput {
  pid: number;
  rc: number;
  startedAtMs: number;
  exitedAtMs: number;
  tailLines: string[];
}

export interface GatewayCrashEvidence {
  timestamp: string;
  pid: number;
  rc: number;
  uptimeMs: number;
  exitContext: GatewayExitContext;
  tailLines: string[];
}

const STARTUP_CRASH_MS = 60_000;

export function supervisorHeartbeatPath(root: string): string {
  return join(root, "runtime", "supervisor-heartbeat.json");
}

export function autopilotHeartbeatPath(root: string): string {
  return join(root, "runtime", "autopilot-heartbeat.json");
}

export function crashEvidenceDir(root: string): string {
  return join(root, "runtime", "crash-evidence");
}

export function crashEvidenceIndexPath(root: string): string {
  return join(crashEvidenceDir(root), "gateway-exits.jsonl");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeSupervisorHeartbeat(
  root: string,
  input: { pid?: number; now?: Date; startedAt?: Date }
): Promise<SupervisorHeartbeat> {
  const now = input.now ?? new Date();
  const startedAt = input.startedAt ?? now;
  const heartbeat: SupervisorHeartbeat = {
    timestamp: now.toISOString(),
    pid: input.pid ?? process.pid,
    uptimeMs: Math.max(0, now.getTime() - startedAt.getTime()),
    startedAt: startedAt.toISOString()
  };
  await writeJson(supervisorHeartbeatPath(root), heartbeat);
  return heartbeat;
}

export async function readSupervisorHeartbeat(root: string): Promise<SupervisorHeartbeat | undefined> {
  const contents = await readFile(supervisorHeartbeatPath(root), "utf8").catch(() => "");
  if (!contents.trim()) {
    return undefined;
  }
  return JSON.parse(contents) as SupervisorHeartbeat;
}

export function isSupervisorHeartbeatStale(
  heartbeat: SupervisorHeartbeat | undefined,
  options: { now?: Date; staleMs: number }
): boolean {
  if (!heartbeat) {
    return true;
  }
  const timestamp = Date.parse(heartbeat.timestamp);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return (options.now ?? new Date()).getTime() - timestamp > options.staleMs;
}

export async function writeAutopilotHeartbeat(
  root: string,
  input: { lastTickAttempt?: string; lastTickResult?: string; currentStage?: string; now?: Date }
): Promise<AutopilotHeartbeat> {
  const existing = await readFile(autopilotHeartbeatPath(root), "utf8")
    .then((text) => JSON.parse(text) as Partial<AutopilotHeartbeat>)
    .catch((): Partial<AutopilotHeartbeat> => ({}));
  const now = input.now ?? new Date();
  const heartbeat: AutopilotHeartbeat = {
    ...existing,
    updatedAt: now.toISOString(),
    pid: process.pid,
    lastTickAttempt: input.lastTickAttempt ?? existing.lastTickAttempt,
    lastTickResult: input.lastTickResult ?? existing.lastTickResult,
    currentStage: input.currentStage ?? existing.currentStage
  };
  await writeJson(autopilotHeartbeatPath(root), heartbeat);
  return heartbeat;
}

export function classifyGatewayExit(input: GatewayCrashEvidenceInput): GatewayExitContext {
  if (input.rc === 0) {
    return "clean_exit";
  }
  if (input.rc >= 128) {
    return "signal_exit";
  }
  const uptimeMs = Math.max(0, input.exitedAtMs - input.startedAtMs);
  if (uptimeMs <= STARTUP_CRASH_MS) {
    return "startup_crash";
  }
  const tail = input.tailLines.join("\n");
  if (/(?:autopilot|ticker|run-cycle|runCycle|cycle)/i.test(tail)) {
    return "tick_after_crash";
  }
  return "runtime_crash";
}

export async function captureGatewayCrashEvidence(
  root: string,
  input: GatewayCrashEvidenceInput
): Promise<GatewayCrashEvidence> {
  const evidence: GatewayCrashEvidence = {
    timestamp: new Date(input.exitedAtMs).toISOString(),
    pid: input.pid,
    rc: input.rc,
    uptimeMs: Math.max(0, input.exitedAtMs - input.startedAtMs),
    exitContext: classifyGatewayExit(input),
    tailLines: input.tailLines
  };
  const dir = crashEvidenceDir(root);
  const filename = `gateway-exit-${new Date(input.exitedAtMs).toISOString().replace(/[:.]/g, "-")}-${input.pid}.json`;
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, filename), evidence);
  await appendFile(crashEvidenceIndexPath(root), `${JSON.stringify({ ...evidence, file: filename })}\n`, "utf8");
  return evidence;
}
