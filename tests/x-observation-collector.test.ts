import { mkdtempSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { collectObservations, readTodayObservations } from "../src/services/xObservationCollector";
import { isInCooldown } from "../src/services/birdRateLimiter";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-x-observation-collector-"));
}

describe("x observation collector", () => {
  it("uses bird runner once and then reads the daily cache", async () => {
    const root = workspace();
    const runner = vi.fn(async () => ({
      stdout: ["society satire is spiking", "unrelated market noise"].join("\n")
    }));

    const first = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      personaText: "society satire",
      runner
    });
    const second = await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      personaText: "society satire",
      runner
    });

    expect(first.status).toBe("collected");
    expect(second.status).toBe("cached");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(await readTodayObservations(root, new Date("2026-04-29T03:00:00.000Z"))).toContain("society satire");
  });

  it("refreshes the daily cache after six hours", async () => {
    const root = workspace();
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: "first city observation" })
      .mockResolvedValueOnce({ stdout: "second city observation" });
    const first = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      runner
    });
    await utimes(first.path, new Date("2026-04-29T01:00:00.000Z"), new Date("2026-04-29T01:00:00.000Z"));

    const second = await collectObservations(root, {
      now: new Date("2026-04-29T08:00:00.000Z"),
      runner
    });

    expect(second.status).toBe("collected");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(await readTodayObservations(root, new Date("2026-04-29T08:00:00.000Z"))).toContain("second city observation");
  });

  it("blocks secret-like observation output", async () => {
    const root = workspace();
    const result = await collectObservations(root, {
      runner: async () => ({ stdout: "API_KEY=do-not-store" })
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("secret");
  });

  it("triggers cooldown for bird rate-limit output", async () => {
    const root = workspace();
    const result = await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      runner: async () => ({ stdout: "HTTP 429 rate limit" })
    });

    expect(result.status).toBe("cooldown");
    expect(await isInCooldown(root, new Date("2026-04-29T02:00:00.000Z"))).toBe(true);
  });

  it("skips when the rate limiter denies another call", async () => {
    const root = workspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "config-overrides.json"), JSON.stringify({ bird: { rateLimits: { dailyMax: 1, minIntervalMinutes: 60 } } }), "utf8");
    await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      runner: async () => ({ stdout: "first observation" })
    });
    await writeFile(join(root, "observations", "2026-04-29.md"), "", "utf8");

    const result = await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      runner: async () => ({ stdout: "second observation" })
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("daily bird call limit");
  });
});
