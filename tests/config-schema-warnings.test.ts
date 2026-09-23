import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/schema";

describe("config schema warnings", () => {
  it("warns when a platform is armed while global live-go remains off", () => {
    const result = validateConfig({
      distribution: {
        liveGoArmed: false,
        platforms: {
          instagram: {
            enabled: true,
            liveGoArmed: true
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      "config.distribution.platforms.instagram.liveGoArmed is true while config.distribution.liveGoArmed is false"
    );
  });

  it("warns when a disabled platform still carries a positive posting cap", () => {
    const result = validateConfig({
      distribution: {
        platforms: {
          x: {
            enabled: false,
            liveGoArmed: false,
            maxPostsPerDay: 3
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      "config.distribution.platforms.x.maxPostsPerDay is positive while platform is disabled"
    );
  });
});
