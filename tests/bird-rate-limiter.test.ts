import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isBirdBanIndication, isInCooldown, recordBirdCall, triggerCooldown, tryAcquireBirdCall } from "../src/services/birdRateLimiter";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-bird-rate-limiter-"));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bird rate limiter", () => {
  it("enforces daily max and per-call interval", async () => {
    const root = workspace();
    vi.stubEnv("OPENCLAW_BIRD_DAILY_MAX", "2");
    vi.stubEnv("OPENCLAW_BIRD_MIN_INTERVAL_MINUTES", "60");
    const first = new Date("2026-04-29T00:00:00.000Z");

    expect((await tryAcquireBirdCall(root, first)).allowed).toBe(true);
    await recordBirdCall(root, first);
    const intervalBlocked = await tryAcquireBirdCall(root, new Date("2026-04-29T00:30:00.000Z"));
    expect(intervalBlocked.allowed).toBe(false);
    expect(intervalBlocked.reason).toContain("min interval");
    await recordBirdCall(root, new Date("2026-04-29T01:01:00.000Z"));
    const dailyBlocked = await tryAcquireBirdCall(root, new Date("2026-04-29T02:02:00.000Z"));
    expect(dailyBlocked.allowed).toBe(false);
    expect(dailyBlocked.reason).toContain("daily bird call limit");
  });

  it("triggers 24h cooldown for ban indicators", async () => {
    const root = workspace();
    const now = new Date("2026-04-29T03:00:00.000Z");

    expect(isBirdBanIndication("HTTP 429 rate limit")).toBe(true);
    await triggerCooldown(root, "HTTP 403 suspended", now);

    expect(await isInCooldown(root, new Date("2026-04-30T02:59:00.000Z"))).toBe(true);
    expect(await isInCooldown(root, new Date("2026-04-30T03:01:00.000Z"))).toBe(false);
  });

  it("does not treat ordinary tweet text containing ban substrings as a ban", () => {
    expect(isBirdBanIndication("urban night bands under a banner")).toBe(false);
    expect(isBirdBanIndication("the account was banned after rate limit errors")).toBe(true);
  });

  it("ignores bare Japanese 制限/凍結 words that appear in ordinary tweets", () => {
    expect(isBirdBanIndication("首都高で速度制限が解除された")).toBe(false);
    expect(isBirdBanIndication("路面凍結に注意して")).toBe(false);
    expect(isBirdBanIndication("交通規制と入場制限のお知らせ")).toBe(false);
  });

  it("still fires on bird-error compound Japanese phrases and error tokens", () => {
    expect(isBirdBanIndication("レート制限に達しました")).toBe(true);
    expect(isBirdBanIndication("アカウント凍結の可能性")).toBe(true);
    expect(isBirdBanIndication("API制限を超過")).toBe(true);
    expect(isBirdBanIndication("利用制限がかかっています")).toBe(true);
    expect(isBirdBanIndication("HTTP 429 rate limit")).toBe(true);
  });

  it("reads runtime override limits", async () => {
    const root = workspace();
    await mkdir(join(root, "runtime"), { recursive: true });
    await writeFile(
      join(root, "runtime", "config-overrides.json"),
      JSON.stringify({ bird: { rateLimits: { dailyMax: 1, minIntervalMinutes: 1 } } }),
      "utf8"
    );
    await recordBirdCall(root, new Date("2026-04-29T00:00:00.000Z"));

    const blocked = await tryAcquireBirdCall(root, new Date("2026-04-29T00:02:00.000Z"));

    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("daily bird call limit");
  });
});
