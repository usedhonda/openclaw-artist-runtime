import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditEvent, JsonlHealth } from "../types.js";

export async function inspectAuditLog(path: string): Promise<JsonlHealth> {
  try {
    const contents = await readFile(path, "utf8");
    const lines = contents.split("\n").filter(Boolean);
    const errors: string[] = [];
    lines.forEach((line, index) => {
      try {
        JSON.parse(line);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`line ${index + 1}: ${message}`);
      }
    });
    return { healthy: errors.length === 0, lineCount: lines.length, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return { healthy: true, lineCount: 0, errors: [] };
    }
    return { healthy: false, lineCount: 0, errors: [message] };
  }
}

export function createAuditEvent(input: Omit<AuditEvent, "timestamp"> & Partial<Pick<AuditEvent, "timestamp">>): AuditEvent {
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...input
  };
}

export async function appendAuditLog(path: string, event: AuditEvent): Promise<AuditEvent> {
  const health = await inspectAuditLog(path);
  if (!health.healthy) {
    throw new Error(`audit log is unhealthy: ${health.errors.join("; ")}`);
  }

  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}
