import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callbackActionLedgerPath, readCallbackActionEntries, type CallbackActionEntry, type CallbackActionStatus } from "../src/services/callbackActionRegistry";
import { callbackCleanupStatePath, cleanupExpiredCallbacks } from "../src/services/callbackLedgerMaintenance";

const statuses: CallbackActionStatus[] = [
  "pending",
  "applied",
  "discarded",
  "updated",
  "duplicate",
  "expired",
  "unauthorized",
  "failed"
];

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "artist-runtime-callback-cleanup-"));
}

function entry(callbackId: string, status: CallbackActionStatus, expiresAt: number): CallbackActionEntry {
  return {
    callbackId,
    action: "proposal_yes",
    chatId: 1,
    messageId: 2,
    userId: 3,
    createdAt: expiresAt - 1000,
    expiresAt,
    status
  };
}

async function writeLedger(root: string, entries: CallbackActionEntry[]): Promise<void> {
  const path = callbackActionLedgerPath(root);
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(path, `${entries.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
}

describe("callback ledger maintenance", () => {
  it("removes entries whose expiresAt is older than retention and keeps fresh entries", async () => {
    const root = await tempRoot();
    const now = new Date("2026-04-29T00:00:00.000Z");
    await writeLedger(root, [
      entry("old-applied", "applied", Date.parse("2026-04-20T00:00:00.000Z")),
      entry("fresh-expired", "expired", Date.parse("2026-04-28T00:00:00.000Z")),
      entry("future-pending", "pending", Date.parse("2026-04-30T00:00:00.000Z"))
    ]);

    const result = await cleanupExpiredCallbacks(root, { now: () => now });

    expect(result).toEqual({ removed: 1, kept: 2, lastCleanupAt: now.toISOString() });
    expect((await readCallbackActionEntries(root)).map((item) => item.callbackId)).toEqual(["fresh-expired", "future-pending"]);
    const runtimeFiles = await readdir(join(root, "runtime"));
    expect(runtimeFiles.some((name) => /^callback-actions\.jsonl\.backup-\d{8}T\d{6}Z$/.test(name))).toBe(true);
  });

  it("rate-limits consecutive cleanup runs without rewriting the ledger", async () => {
    const root = await tempRoot();
    await writeLedger(root, [
      entry("old-failed", "failed", Date.parse("2026-04-20T00:00:00.000Z"))
    ]);
    const first = await cleanupExpiredCallbacks(root, { now: () => new Date("2026-04-29T00:00:00.000Z") });
    await writeLedger(root, [
      entry("old-duplicate", "duplicate", Date.parse("2026-04-20T00:00:00.000Z"))
    ]);

    const second = await cleanupExpiredCallbacks(root, { now: () => new Date("2026-04-29T01:00:00.000Z") });

    expect(first.removed).toBe(1);
    expect(second).toEqual({ removed: 0, kept: 1, lastCleanupAt: "2026-04-29T00:00:00.000Z" });
    expect((await readCallbackActionEntries(root)).map((item) => item.callbackId)).toEqual(["old-duplicate"]);
  });

  it("treats an empty or missing ledger as a no-op and creates initial state", async () => {
    const root = await tempRoot();
    const now = new Date("2026-04-29T00:00:00.000Z");

    await expect(cleanupExpiredCallbacks(root, { now: () => now })).resolves.toEqual({
      removed: 0,
      kept: 0,
      lastCleanupAt: now.toISOString()
    });
    await expect(readFile(callbackCleanupStatePath(root), "utf8")).resolves.toContain(now.toISOString());
  });

  it("uses expiresAt retention consistently across callback statuses and leaves unexpired pending entries", async () => {
    const root = await tempRoot();
    const now = new Date("2026-04-29T00:00:00.000Z");
    await writeLedger(root, [
      ...statuses.map((status) => entry(`old-${status}`, status, Date.parse("2026-04-20T00:00:00.000Z"))),
      entry("pending-future", "pending", Date.parse("2026-04-30T00:00:00.000Z"))
    ]);

    const result = await cleanupExpiredCallbacks(root, { now: () => now });

    expect(result.removed).toBe(statuses.length);
    expect((await readCallbackActionEntries(root)).map((item) => item.callbackId)).toEqual(["pending-future"]);
  });

  it("does not touch callback-audit.jsonl", async () => {
    const root = await tempRoot();
    await writeLedger(root, [
      entry("old-applied", "applied", Date.parse("2026-04-20T00:00:00.000Z"))
    ]);
    const auditPath = join(root, "runtime", "callback-audit.jsonl");
    const auditText = "{\"timestamp\":\"2026-04-20T00:00:00.000Z\",\"result\":\"applied\"}\n";
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(auditPath, auditText, "utf8");

    await cleanupExpiredCallbacks(root, { now: () => new Date("2026-04-29T00:00:00.000Z") });

    await expect(readFile(auditPath, "utf8")).resolves.toBe(auditText);
  });
});
