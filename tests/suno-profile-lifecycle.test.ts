import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { SunoBrowserWorker } from "../src/services/sunoBrowserWorker";
import {
  createSnapshot,
  defaultSunoProfileBackupRoot,
  detectStaleProfile,
  listSnapshots,
  pruneSnapshots
} from "../src/services/sunoProfileLifecycle";

async function createProfile(root: string, timestamp: Date): Promise<string> {
  const profile = join(root, ".openclaw-browser-profiles", "suno");
  await mkdir(join(profile, "Default"), { recursive: true });
  const cookieFile = join(profile, "Default", "Cookies");
  await writeFile(cookieFile, "cookie-state", "utf8");
  await touchTree(profile, timestamp);
  return profile;
}

async function touchTree(path: string, timestamp: Date): Promise<void> {
  const { utimes } = await import("node:fs/promises");
  await utimes(path, timestamp, timestamp).catch(() => undefined);
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await touchTree(child, timestamp);
    } else {
      await utimes(child, timestamp, timestamp);
    }
  }
}

describe("Suno profile lifecycle", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats a missing profile as stale without throwing", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-missing-"));
    const profile = join(root, ".openclaw-browser-profiles", "suno");

    const status = await detectStaleProfile(profile, 30, new Date("2026-04-24T00:00:00.000Z"));

    expect(status).toMatchObject({
      profilePath: profile,
      stale: true,
      reason: "missing"
    });
  });

  it("detects profiles older than the configured stale window", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-stale-"));
    const profile = await createProfile(root, new Date("2026-03-01T00:00:00.000Z"));

    const status = await detectStaleProfile(profile, 30, new Date("2026-04-24T00:00:00.000Z"));

    expect(status.stale).toBe(true);
    expect(status.reason).toBe("stale");
    expect(status.ageDays).toBeGreaterThan(30);
  });

  it("keeps recently touched profiles fresh", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-fresh-"));
    const profile = await createProfile(root, new Date("2026-04-23T00:00:00.000Z"));

    const status = await detectStaleProfile(profile, 30, new Date("2026-04-24T00:00:00.000Z"));

    expect(status.stale).toBe(false);
    expect(status.reason).toBe("fresh");
  });

  it("creates daily snapshots and prunes the oldest generations", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-snapshot-"));
    const profile = await createProfile(root, new Date("2026-04-20T00:00:00.000Z"));
    const backupRoot = defaultSunoProfileBackupRoot(profile);

    await createSnapshot(profile, backupRoot, new Date("2026-04-20T00:00:00.000Z"));
    await createSnapshot(profile, backupRoot, new Date("2026-04-21T00:00:00.000Z"));
    await createSnapshot(profile, backupRoot, new Date("2026-04-22T00:00:00.000Z"));
    await createSnapshot(profile, backupRoot, new Date("2026-04-23T00:00:00.000Z"));

    expect((await listSnapshots(backupRoot)).map((snapshot) => snapshot.name)).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
      "2026-04-23"
    ]);
    expect(await pruneSnapshots(backupRoot, 3)).toEqual(["2026-04-20"]);
    expect((await listSnapshots(backupRoot)).map((snapshot) => snapshot.name)).toEqual([
      "2026-04-21",
      "2026-04-22",
      "2026-04-23"
    ]);
  });

  it("surfaces the stale profile flag through worker status", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-status-"));
    await ensureArtistWorkspace(root);
    const profile = join(root, ".openclaw-browser-profiles", "suno");
    const workerStatus = await new SunoBrowserWorker(root, { driverMode: "playwright", profilePath: profile }).status();

    expect(workerStatus.sunoProfileStale).toBe(true);
    expect(workerStatus.sunoProfileDetail).toContain("Suno profile is missing");
  });

  it("prints local diagnose information without opening a browser", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-profile-diagnose-"));
    const profile = await createProfile(root, new Date("2026-04-23T00:00:00.000Z"));

    const output = execFileSync("bash", ["scripts/suno-profile-diagnose.sh", profile], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const profileStat = await stat(profile);

    expect(profileStat.isDirectory()).toBe(true);
    expect(output).toContain(`profile_path=${profile}`);
    expect(output).toContain("profile_state=present");
    expect(output).toContain("cookie_files=1");
    expect(output).toContain("storage_usage=");
  });
});
