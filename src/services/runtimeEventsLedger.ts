import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuntimeEvent } from "./runtimeEventBus.js";

function ledgerPath(root: string): string {
  return join(root, "runtime", "runtime-events.jsonl");
}

export async function appendRuntimeEvent(root: string, event: RuntimeEvent): Promise<RuntimeEvent> {
  const path = ledgerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export async function readRuntimeEvents(root: string, limit = 20): Promise<RuntimeEvent[]> {
  const contents = await readFile(ledgerPath(root), "utf8").catch(() => "");
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RuntimeEvent)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit);
}

function eventSongId(event: RuntimeEvent): string | undefined {
  return "songId" in event && typeof event.songId === "string" ? event.songId : undefined;
}

export async function readSongEventsAsc(root: string, songId: string, limit = 200): Promise<RuntimeEvent[]> {
  try {
    const events = await readRuntimeEvents(root, Number.MAX_SAFE_INTEGER);
    return events
      .filter((event) => eventSongId(event) === songId)
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(-Math.max(0, limit));
  } catch {
    return [];
  }
}
