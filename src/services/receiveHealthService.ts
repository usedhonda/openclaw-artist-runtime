import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TelegramReceiveHealth } from "../types.js";

/**
 * Telegram receive-health instrumentation (Plan v10.65 Layer 1).
 *
 * Records the raw timestamp of the last inbound text and last callback_query
 * that actually reached the plugin handlers. This is a SEPARATE state file from
 * AutopilotRunState on purpose: the inbound path and the autopilot ticker write
 * on independent schedules, and co-locating them risks a read-modify-write race
 * that could corrupt stage/currentSongId. A lost timestamp here is harmless.
 *
 * No healthy|stale verdict is derived. The plugin cannot tell "receive broke"
 * from "operator sent nothing" (that is the emit≠delivery inverse trap). We only
 * surface the facts; humans (and the /status display) read the elapsed time.
 */

export function telegramReceiveHealthPath(root: string): string {
  return join(root, "runtime", "telegram-receive-health.json");
}

export async function readReceiveHealth(root: string): Promise<TelegramReceiveHealth> {
  const raw = await readFile(telegramReceiveHealthPath(root), "utf8").catch(() => "");
  if (!raw) {
    return { updatedAt: new Date(0).toISOString() };
  }
  try {
    return JSON.parse(raw) as TelegramReceiveHealth;
  } catch {
    return { updatedAt: new Date(0).toISOString() };
  }
}

async function writeReceiveHealth(root: string, next: TelegramReceiveHealth): Promise<void> {
  const path = telegramReceiveHealthPath(root);
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

/** Record that an inbound text/command physically reached the plugin handler. */
export async function stampInbound(root: string, now = Date.now()): Promise<void> {
  const current = await readReceiveHealth(root);
  await writeReceiveHealth(root, {
    ...current,
    lastInboundAt: now,
    updatedAt: new Date(now).toISOString()
  }).catch(() => undefined);
}

/** Record that a callback_query physically reached the plugin handler. */
export async function stampCallback(root: string, now = Date.now()): Promise<void> {
  const current = await readReceiveHealth(root);
  await writeReceiveHealth(root, {
    ...current,
    lastCallbackAt: now,
    updatedAt: new Date(now).toISOString()
  }).catch(() => undefined);
}
