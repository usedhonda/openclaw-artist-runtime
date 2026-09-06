import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchSunoFeedStatus, type FetchSunoFeedClipsOptions, type SunoFeedFetchResult } from "./sunoFeedHarvest.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

/**
 * suno-cli session (session.json -> Clerk JWT) validity precheck.
 *
 * Reuses the same feed client the take-harvest reconciliation uses (a session that
 * cannot reach the feed is exactly the condition that made cdpHumanAssistDriver fall
 * back to an untrusted DOM-only take detection). This module only records diagnostics
 * and rate-limits the operator notice; it never gates the create attempt itself.
 */

const NOTIFY_INTERVAL_MS = 60 * 60 * 1000; // once per hour, tombstone-style

export interface SunoCliSessionStatus {
  valid: boolean;
  checkedAt: string;
  reason?: string;
}

interface SunoCliSessionExpiredTombstone {
  notifiedAt: string;
}

function sunoRuntimeDir(workspaceRoot: string): string {
  return join(workspaceRoot, "runtime", "suno");
}

function statusFilePath(workspaceRoot: string): string {
  return join(sunoRuntimeDir(workspaceRoot), "cli-session-status.json");
}

function tombstonePath(workspaceRoot: string): string {
  return join(sunoRuntimeDir(workspaceRoot), "cli-session-expired-tombstone.json");
}

async function readTombstone(workspaceRoot: string): Promise<SunoCliSessionExpiredTombstone | undefined> {
  const raw = await readFile(tombstonePath(workspaceRoot), "utf8").catch(() => "");
  if (!raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as SunoCliSessionExpiredTombstone;
    return typeof parsed?.notifiedAt === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface CheckSunoCliSessionStatusDeps {
  fetchStatus?: (options: FetchSunoFeedClipsOptions) => Promise<SunoFeedFetchResult>;
  now?: () => number;
}

/**
 * Best-effort precheck: is the suno-cli session still able to reach Suno's feed?
 * Persists the result for /api/status diagnostics (`suno.cliSession`) and, on an
 * invalid session, emits `suno_cli_session_expired` at most once per hour (tombstone
 * cleared the moment the session is valid again, matching the creative-monotony
 * watchdog pattern) so the operator gets one actionable notice instead of a
 * per-attempt flood. Never throws -- a failure here must never block the caller's
 * create attempt.
 */
export async function checkSunoCliSessionStatus(
  workspaceRoot: string,
  sessionFile: string,
  deps: CheckSunoCliSessionStatusDeps = {}
): Promise<SunoCliSessionStatus> {
  const fetchStatus = deps.fetchStatus ?? fetchSunoFeedStatus;
  const now = deps.now ?? Date.now;
  const feedStatus = await fetchStatus({ sessionFile }).catch(
    (): SunoFeedFetchResult => ({ clips: [], available: false, reason: "network_error" })
  );
  const status: SunoCliSessionStatus = {
    valid: feedStatus.available,
    checkedAt: new Date(now()).toISOString(),
    reason: feedStatus.available ? undefined : feedStatus.reason
  };

  await mkdir(sunoRuntimeDir(workspaceRoot), { recursive: true }).catch(() => undefined);
  await writeFile(statusFilePath(workspaceRoot), `${JSON.stringify(status)}\n`, "utf8").catch(() => undefined);

  if (status.valid) {
    await rm(tombstonePath(workspaceRoot), { force: true }).catch(() => undefined);
    return status;
  }

  const tombstone = await readTombstone(workspaceRoot);
  const lastNotifiedMs = tombstone ? Date.parse(tombstone.notifiedAt) : NaN;
  const shouldNotify = !Number.isFinite(lastNotifiedMs) || now() - lastNotifiedMs >= NOTIFY_INTERVAL_MS;
  if (shouldNotify) {
    emitRuntimeEvent({
      type: "suno_cli_session_expired",
      reason: status.reason ?? "feed_unreachable",
      timestamp: now()
    });
    await writeFile(
      tombstonePath(workspaceRoot),
      `${JSON.stringify({ notifiedAt: new Date(now()).toISOString() } satisfies SunoCliSessionExpiredTombstone)}\n`,
      "utf8"
    ).catch(() => undefined);
  }

  return status;
}

/**
 * Read the persisted precheck result for /api/status diagnostics. Undefined when no
 * precheck has run yet (no workspace, or human-assist has never attempted a create).
 */
export async function readSunoCliSessionStatus(workspaceRoot: string): Promise<SunoCliSessionStatus | undefined> {
  const raw = await readFile(statusFilePath(workspaceRoot), "utf8").catch(() => "");
  if (!raw.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as SunoCliSessionStatus;
    return typeof parsed?.valid === "boolean" && typeof parsed?.checkedAt === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
