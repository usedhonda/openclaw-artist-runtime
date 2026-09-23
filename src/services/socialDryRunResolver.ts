import type { ArtistRuntimeConfig, SocialPlatform } from "../types.js";

export interface SocialDryRunResolverInput {
  global: {
    autopilotDryRun: boolean;
  };
  distribution: {
    enabled: boolean;
    liveGoArmed: boolean;
  };
  platform: {
    enabled: boolean;
    liveGoArmed: boolean;
  };
}

export function resolveSocialDryRun(input: SocialDryRunResolverInput): boolean {
  return input.global.autopilotDryRun
    || !input.distribution.enabled
    || !input.distribution.liveGoArmed
    || !input.platform.enabled
    || !input.platform.liveGoArmed;
}

export function resolvePlatformSocialDryRun(config: ArtistRuntimeConfig, platform: SocialPlatform): boolean {
  return resolveSocialDryRun({
    global: {
      autopilotDryRun: config.autopilot.dryRun
    },
    distribution: {
      enabled: config.distribution.enabled,
      liveGoArmed: config.distribution.liveGoArmed
    },
    platform: {
      enabled: config.distribution.platforms[platform].enabled,
      liveGoArmed: config.distribution.platforms[platform].liveGoArmed
    }
  });
}

export function buildEffectiveDryRunMap(config: ArtistRuntimeConfig): Record<SocialPlatform, boolean> {
  return {
    x: resolvePlatformSocialDryRun(config, "x"),
    instagram: resolvePlatformSocialDryRun(config, "instagram"),
    tiktok: resolvePlatformSocialDryRun(config, "tiktok")
  };
}
