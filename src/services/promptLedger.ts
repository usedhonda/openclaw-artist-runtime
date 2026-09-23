import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JsonlHealth, PromptLedgerEntry } from "../types.js";

export function getSongPromptLedgerPath(root: string, songId: string): string {
  return join(root, "songs", songId, "prompts", "prompt-ledger.jsonl");
}

export async function inspectJsonlFile(path: string): Promise<JsonlHealth> {
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

export function createPromptLedgerEntry(entry: Omit<PromptLedgerEntry, "id" | "timestamp"> & Partial<Pick<PromptLedgerEntry, "id" | "timestamp">>): PromptLedgerEntry {
  return {
    id: entry.id ?? `plg_${Date.now().toString(36)}`,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    ...entry
  };
}

export async function appendPromptLedger(path: string, entry: PromptLedgerEntry): Promise<PromptLedgerEntry> {
  const health = await inspectJsonlFile(path);
  if (!health.healthy) {
    throw new Error(`prompt ledger is unhealthy: ${health.errors.join("; ")}`);
  }

  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}
