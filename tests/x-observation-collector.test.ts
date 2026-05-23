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
      stdout: [
        "@watch_a society satire is spiking https://x.com/watch_a/status/1111111111111111111 2026-04-29T00:30:00.000Z",
        "@watch_b unrelated market noise https://x.com/watch_b/status/2222222222222222222 2026-04-29T00:45:00.000Z"
      ].join("\n")
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
      .mockResolvedValueOnce({ stdout: "@firstwatcher first city observation https://x.com/firstwatcher/status/1111111111111111111 2026-04-29T01:00:00.000Z" })
      .mockResolvedValueOnce({ stdout: "@secondwatcher second city observation https://x.com/secondwatcher/status/2222222222222222222 2026-04-29T08:00:00.000Z" });
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

  it("parses bird v0.8 chunk-by-record output with 50-char separator lines", async () => {
    const root = workspace();
    const separator = "──────────────────────────────────────────────────";
    const chunkOutput = [
      "@watch_a (Watch Alpha):",
      "society satire is spiking in 六本木 tonight",
      "https://t.co/short",
      "date: Sat May 23 01:17:15 +0000 2026",
      "url: https://x.com/watch_a/status/2057994231491568042",
      separator,
      "@watch_b (Watch Beta):",
      "都市 再開発 white facade",
      "PHOTO: https://pbs.twimg.com/media/example.jpg",
      "date: Sat May 23 00:57:13 +0000 2026",
      "url: https://x.com/watch_b/status/2057989190898573621",
      separator,
      "@watch_c (Watch Gamma):",
      "経営者 が ロビイング してる話",
      "date: Sat May 23 00:33:43 +0000 2026",
      "url: https://x.com/watch_c/status/2057983275981996161",
      ""
    ].join("\n");
    const runner = vi.fn(async () => ({ stdout: chunkOutput }));

    const result = await collectObservations(root, {
      now: new Date("2026-05-23T01:30:00.000Z"),
      personaText: "society satire 経営者 再開発",
      runner
    });

    expect(result.status).toBe("collected");
    expect(runner).toHaveBeenCalledTimes(1);
    const cache = await readTodayObservations(root, new Date("2026-05-23T01:30:00.000Z"));
    expect(cache).toContain("society satire");
    expect(cache).toContain("再開発");
    expect(cache).toContain("ロビイング");
    expect(cache).toContain("watch_a");
    expect(cache).toContain("watch_b");
    expect(cache).toContain("watch_c");
    expect(cache).toContain("Sat May 23");
  });

  it("skips when the rate limiter denies another call", async () => {
    const root = workspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(join(root, "runtime", "config-overrides.json"), JSON.stringify({ bird: { rateLimits: { dailyMax: 1, minIntervalMinutes: 60 } } }), "utf8");
    await collectObservations(root, {
      now: new Date("2026-04-29T01:00:00.000Z"),
      runner: async () => ({ stdout: "@watcher first observation https://x.com/watcher/status/1111111111111111111 2026-04-29T01:00:00.000Z" })
    });
    await writeFile(join(root, "observations", "2026-04-29.md"), "", "utf8");

    const result = await collectObservations(root, {
      now: new Date("2026-04-29T02:00:00.000Z"),
      runner: async () => ({ stdout: "@watcher second observation https://x.com/watcher/status/2222222222222222222 2026-04-29T02:00:00.000Z" })
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("daily bird call limit");
  });
});
