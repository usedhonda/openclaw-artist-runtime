import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pruneSnapshotsOlderThan } from "../src/services/sunoProfileLifecycle.js";

async function snapshot(path: string, mtime: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const date = new Date(mtime);
  await utimes(path, date, date);
}

describe("Suno profile snapshot retention", () => {
  it("prunes profile snapshots older than the retention window and keeps fresh snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-retention-"));
    const snapshotRoot = join(root, "runtime", "suno", "profile-snapshots");
    const oldPath = join(snapshotRoot, "2025-01-01");
    const freshPath = join(snapshotRoot, "2026-04-24");
    await snapshot(oldPath, "2025-01-01T00:00:00.000Z");
    await snapshot(freshPath, "2026-04-24T00:00:00.000Z");

    const removed = await pruneSnapshotsOlderThan(snapshotRoot, 365, new Date("2026-04-25T00:00:00.000Z"));

    expect(removed).toEqual(["2025-01-01"]);
    await expect(stat(oldPath)).rejects.toThrow();
    await expect(stat(freshPath)).resolves.toBeTruthy();
  });

  it("returns an empty removal list when the profile snapshot root is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-retention-missing-"));

    await expect(pruneSnapshotsOlderThan(join(root, "runtime", "suno", "profile-snapshots"))).resolves.toEqual([]);
  });

  it("surfaces profile snapshot candidates through cleanup-runtime dry-run JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-retention-script-"));
    const snapshotRoot = join(root, "runtime", "suno", "profile-snapshots");
    const oldPath = join(snapshotRoot, "2025-01-01");
    const freshPath = join(snapshotRoot, "2026-04-24");
    await snapshot(oldPath, "2025-01-01T00:00:00.000Z");
    await snapshot(freshPath, "2026-04-24T00:00:00.000Z");

    const output = execFileSync("bash", ["scripts/cleanup-runtime.sh", "--root", root, "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const parsed = JSON.parse(output) as {
      candidates: string[];
      profileSnapshotRetentionDays: number;
      profileSnapshotCandidates: string[];
    };

    expect(parsed.candidates).not.toContain(snapshotRoot);
    expect(parsed.profileSnapshotRetentionDays).toBe(365);
    expect(parsed.profileSnapshotCandidates).toEqual([oldPath]);
    await expect(stat(oldPath)).resolves.toBeTruthy();
    await expect(stat(freshPath)).resolves.toBeTruthy();
  });
});
