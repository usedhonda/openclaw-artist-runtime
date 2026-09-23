import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

describe("snapshot-runtime-state.sh", () => {
  it("copies runtime/state and prunes snapshots older than the retention window", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-state-snapshot-"));
    const stateDir = join(root, "runtime", "state");
    const oldSnapshot = join(root, "runtime", "state-snapshots", "20260101T000000Z");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "state.json"), '{"ok":true}\n', "utf8");
    await mkdir(oldSnapshot, { recursive: true });
    await writeFile(join(oldSnapshot, "old.json"), "old", "utf8");
    const old = new Date("2026-01-01T00:00:00.000Z");
    await utimes(oldSnapshot, old, old);

    const output = execFileSync("bash", ["scripts/snapshot-runtime-state.sh", "--root", root, "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, OPENCLAW_STATE_SNAPSHOT_RETENTION_DAYS: "1" }
    });
    const parsed = JSON.parse(output) as { created: boolean; snapshotDir: string; pruned: string[] };

    expect(parsed.created).toBe(true);
    expect(basename(parsed.snapshotDir)).toMatch(/^\d{8}T\d{6}Z$/);
    expect(await readFile(join(parsed.snapshotDir, "state.json"), "utf8")).toBe('{"ok":true}\n');
    expect(parsed.pruned).toEqual([oldSnapshot]);
    await expect(stat(oldSnapshot)).rejects.toThrow();
  });
});
