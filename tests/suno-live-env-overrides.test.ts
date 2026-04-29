import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRuntimeConfig } from "../src/services/runtimeConfig";

const keys = [
  "OPENCLAW_SUNO_LIVE",
  "OPENCLAW_SUNO_DRIVER",
  "OPENCLAW_SUNO_SUBMIT_MODE",
  "OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE"
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("Suno live env overrides", () => {
  it("enables Playwright live Suno while keeping distribution live gates closed", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-live-env-"));
    mkdirSync(join(root, "runtime"), { recursive: true });
    process.env.OPENCLAW_SUNO_LIVE = "on";
    process.env.OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE = "off";

    const config = await resolveRuntimeConfig({ artist: { workspaceRoot: root } as never });

    expect(config.music.suno.driver).toBe("playwright");
    expect(config.music.suno.submitMode).toBe("live");
    expect(config.autopilot.dryRun).toBe(false);
    expect(config.distribution.liveGoArmed).toBe(false);
    expect(config.distribution.platforms.x.liveGoArmed).toBe(false);
    expect(config.distribution.platforms.instagram.liveGoArmed).toBe(false);
    expect(config.distribution.platforms.tiktok.liveGoArmed).toBe(false);
  });

  it("forces mock mode when the Suno live fallback flag is off", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-live-off-"));
    mkdirSync(join(root, "runtime"), { recursive: true });
    process.env.OPENCLAW_SUNO_LIVE = "off";
    process.env.OPENCLAW_SUNO_DRIVER = "playwright";
    process.env.OPENCLAW_SUNO_SUBMIT_MODE = "live";

    const config = await resolveRuntimeConfig({ artist: { workspaceRoot: root } as never });

    expect(config.music.suno.driver).toBe("mock");
    expect(config.music.suno.submitMode).toBe("skip");
  });
});
