import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Durable single-flight marker for the human-assist Suno create flow.
 *
 * A manual-submit (or captcha-fallback) attempt can wait for the producer for a very
 * long time — with humanAssistTimeoutMinutes=0 it waits indefinitely. The autopilot
 * ticker force-resets its in-memory re-entry guard once a cycle outlives the stall
 * threshold, so without a durable marker a new create attempt starts every tick while
 * the previous one is still waiting: fresh filled tabs pile up and the producer is
 * re-notified every cycle. This file records that exactly one attempt is outstanding so
 * the create choke point can refuse a second one until the first resolves.
 */
export interface HumanAssistPendingMarker {
  songId: string;
  runId?: string;
  pid: number;
  startedAt: string;
}

export function humanAssistPendingPath(workspaceRoot: string): string {
  return join(workspaceRoot, "runtime", "suno", "human-assist-pending.json");
}

export async function writeHumanAssistPending(
  workspaceRoot: string,
  marker: HumanAssistPendingMarker
): Promise<void> {
  const path = humanAssistPendingPath(workspaceRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

export async function removeHumanAssistPending(workspaceRoot: string): Promise<void> {
  await rm(humanAssistPendingPath(workspaceRoot), { force: true }).catch(() => undefined);
}

async function readHumanAssistPending(
  workspaceRoot: string
): Promise<HumanAssistPendingMarker | undefined> {
  const contents = await readFile(humanAssistPendingPath(workspaceRoot), "utf8").catch(() => "");
  if (!contents) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(contents) as Partial<HumanAssistPendingMarker>;
    if (typeof parsed?.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return undefined;
    }
    if (typeof parsed.songId !== "string" || !parsed.songId) {
      return undefined;
    }
    return parsed as HumanAssistPendingMarker;
  } catch {
    return undefined;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process (dead). EPERM: process exists but we can't signal it (alive).
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Return the active pending attempt if one is genuinely outstanding in THIS gateway
 * process. A marker whose pid is dead, belongs to a different process, or is
 * unparseable/invalid is stale — delete it and report no pending attempt so the caller
 * proceeds. (marker.pid === process.pid already implies the process is alive, but the
 * kill(pid, 0) liveness check is kept per the single-flight contract.)
 */
export async function evaluateHumanAssistPending(
  workspaceRoot: string
): Promise<{ songId: string } | undefined> {
  const marker = await readHumanAssistPending(workspaceRoot);
  if (!marker) {
    return undefined;
  }
  if (marker.pid === process.pid && isPidAlive(marker.pid)) {
    return { songId: marker.songId };
  }
  await removeHumanAssistPending(workspaceRoot);
  return undefined;
}
