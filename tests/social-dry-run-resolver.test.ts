import { describe, expect, it } from "vitest";
import { applyConfigDefaults } from "../src/config/schema";
import { buildEffectiveDryRunMap, resolvePlatformSocialDryRun, resolveSocialDryRun } from "../src/services/socialDryRunResolver";

describe("social dry-run resolver", () => {
  it("holds dry-run until global and platform arms are both enabled", () => {
    expect(resolveSocialDryRun({
      global: { autopilotDryRun: false },
      distribution: { enabled: true, liveGoArmed: true },
      platform: { enabled: true, liveGoArmed: true }
    })).toBe(false);

    expect(resolveSocialDryRun({
      global: { autopilotDryRun: false },
      distribution: { enabled: true, liveGoArmed: false },
      platform: { enabled: true, liveGoArmed: true }
    })).toBe(true);

    expect(resolveSocialDryRun({
      global: { autopilotDryRun: false },
      distribution: { enabled: true, liveGoArmed: true },
      platform: { enabled: true, liveGoArmed: false }
    })).toBe(true);
  });

  it("builds the same map used by platform-specific resolution", () => {
    const config = applyConfigDefaults({
      autopilot: { dryRun: false },
      distribution: {
        enabled: true,
        liveGoArmed: true,
        platforms: {
          x: { enabled: true, liveGoArmed: true },
          instagram: { enabled: true, liveGoArmed: false }
        }
      }
    });

    expect(buildEffectiveDryRunMap(config)).toEqual({
      x: false,
      instagram: true,
      tiktok: true
    });
    expect(resolvePlatformSocialDryRun(config, "x")).toBe(false);
    expect(resolvePlatformSocialDryRun(config, "instagram")).toBe(true);
  });
});
