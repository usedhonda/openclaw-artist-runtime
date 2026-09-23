import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { markSpawned, readSongSpawnState, shouldSpawn, songSpawnStatePath } from "../src/services/songSpawnRateLimiter";

describe("song spawn rate limiter", () => {
  it("allows first spawn and blocks until interval passes", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-rate-"));
    const now = new Date("2026-04-29T00:00:00.000Z");

    expect(await shouldSpawn(root, { now, minIntervalHours: 24 })).toBe(true);
    await markSpawned(root, now);

    expect(await shouldSpawn(root, { now: new Date("2026-04-29T12:00:00.000Z"), minIntervalHours: 24 })).toBe(false);
    expect(await shouldSpawn(root, { now: new Date("2026-04-30T00:00:00.000Z"), minIntervalHours: 24 })).toBe(true);
  });

  it("persists state atomically and creates a backup on rewrite", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-spawn-state-"));
    await markSpawned(root, new Date("2026-04-29T00:00:00.000Z"));
    await markSpawned(root, new Date("2026-04-30T00:00:00.000Z"));

    const state = await readSongSpawnState(root);
    expect(state.lastSpawnAt).toBe("2026-04-30T00:00:00.000Z");
    expect(readFileSync(songSpawnStatePath(root), "utf8")).toContain("lastSpawnAt");
    expect(readdirSync(join(root, "runtime")).some((entry) => entry.startsWith("song-spawn-state.json.backup-"))).toBe(true);
  });
});
