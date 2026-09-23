import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artistPulseStatePath, markPulsed, readArtistPulseState, shouldPulse } from "../src/services/artistPulseRateLimiter";

describe("artist pulse rate limiter", () => {
  it("allows first pulse and blocks until interval passes", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-pulse-rate-"));
    const noon = new Date("2026-04-29T12:00:00.000Z");

    expect(await shouldPulse(root, { now: noon, minIntervalHours: 12 })).toBe(true);
    await markPulsed(root, noon);

    expect(await shouldPulse(root, { now: new Date("2026-04-29T18:00:00.000Z"), minIntervalHours: 12 })).toBe(false);
    expect(await shouldPulse(root, { now: new Date("2026-04-30T00:00:00.000Z"), minIntervalHours: 12 })).toBe(true);
  });

  it("persists state atomically and creates a backup on rewrite", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-pulse-state-"));
    await markPulsed(root, new Date("2026-04-29T00:00:00.000Z"));
    await markPulsed(root, new Date("2026-04-29T12:00:00.000Z"));

    const state = await readArtistPulseState(root);
    expect(state.lastPulseAt).toBe("2026-04-29T12:00:00.000Z");
    expect(readFileSync(artistPulseStatePath(root), "utf8")).toContain("lastPulseAt");
    expect(readdirSync(join(root, "runtime")).some((entry) => entry.startsWith("artist-pulse-state.json.backup-"))).toBe(true);
  });
});
