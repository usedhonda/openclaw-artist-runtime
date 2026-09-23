import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AutopilotRunState } from "../types.js";

export interface AutopilotRecoveryClock {
  now(): Date;
}

const systemClock: AutopilotRecoveryClock = {
  now: () => new Date()
};

export const defaultAutopilotRunState: AutopilotRunState = {
  stage: "idle",
  paused: false,
  retryCount: 0,
  cycleCount: 0,
  updatedAt: new Date().toISOString()
};

export function autopilotStatePath(root: string): string {
  return join(root, "runtime", "autopilot-state.json");
}

export function autopilotBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function autopilotStateBackupPath(root: string, date: Date): string {
  return join(root, "runtime", `autopilot-state.backup.${autopilotBackupTimestamp(date)}.json`);
}

export async function backupAutopilotState(
  root: string,
  clock: AutopilotRecoveryClock = systemClock
): Promise<{ backupPath?: string }> {
  const contents = await readFile(autopilotStatePath(root), "utf8").catch(() => "");
  if (!contents) {
    return {};
  }
  const backupPath = autopilotStateBackupPath(root, clock.now());
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(backupPath, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
  return { backupPath };
}

export async function readAutopilotState(root: string): Promise<AutopilotRunState> {
  const contents = await readFile(autopilotStatePath(root), "utf8").catch(() => "");
  if (!contents) {
    return { ...defaultAutopilotRunState };
  }
  return { ...defaultAutopilotRunState, ...(JSON.parse(contents) as Partial<AutopilotRunState>) };
}

export async function writeAutopilotState(root: string, state: AutopilotRunState): Promise<AutopilotRunState> {
  const nextState = { ...state, updatedAt: systemClock.now().toISOString() };
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(autopilotStatePath(root), `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  return nextState;
}

export function buildResetAutopilotState(clock: AutopilotRecoveryClock = systemClock): AutopilotRunState {
  const now = clock.now().toISOString();
  return {
    stage: "planning",
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    lastRunAt: now,
    updatedAt: now,
    blockedReason: null,
    hardStopReason: null,
    pausedReason: null,
    lastError: null
  };
}
