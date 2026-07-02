import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { XObservationAttemptDiagnostic } from "./xObservationCollector.js";

export interface XObservationDiagnosticsSnapshot {
  date: string;
  collectedAt: string;
  attempts: XObservationAttemptDiagnostic[];
  emptyCache: {
    active: boolean;
    ttlMinutes: number;
    until?: string;
  };
}

const emptyCacheTtlMinutes = 20;

export function xObservationDiagnosticsPath(root: string): string {
  return join(root, "runtime", "x-observation-diagnostics.json");
}

export function buildXObservationDiagnosticsSnapshot(input: {
  date: string;
  now: Date;
  attempts: XObservationAttemptDiagnostic[];
  acceptedCount: number;
}): XObservationDiagnosticsSnapshot {
  const empty = input.acceptedCount === 0;
  return {
    date: input.date,
    collectedAt: input.now.toISOString(),
    attempts: input.attempts,
    emptyCache: {
      active: empty,
      ttlMinutes: emptyCacheTtlMinutes,
      until: empty ? new Date(input.now.getTime() + emptyCacheTtlMinutes * 60 * 1000).toISOString() : undefined
    }
  };
}

export async function writeXObservationDiagnostics(
  root: string,
  snapshot: XObservationDiagnosticsSnapshot
): Promise<void> {
  const path = xObservationDiagnosticsPath(root);
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

export async function readXObservationDiagnostics(root: string): Promise<XObservationDiagnosticsSnapshot | undefined> {
  const raw = await readFile(xObservationDiagnosticsPath(root), "utf8").catch(() => "");
  if (!raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as XObservationDiagnosticsSnapshot;
    return parsed && typeof parsed.date === "string" && Array.isArray(parsed.attempts) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
