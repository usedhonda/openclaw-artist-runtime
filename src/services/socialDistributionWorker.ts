import type { ArtistRuntimeConfig } from "../types.js";
import { applyConfigDefaults } from "../config/schema.js";
import { listSongStates } from "./artistState.js";
import { readLatestSocialAction } from "./socialPublishing.js";
import { buildEffectiveDryRunMap } from "./socialDryRunResolver.js";
import type { SocialPlatform } from "../types.js";

function buildEffectiveDryRun(config: ArtistRuntimeConfig): Record<SocialPlatform, boolean> {
  return buildEffectiveDryRunMap(config);
}

function buildPlatformLiveGoArmed(config: ArtistRuntimeConfig): Record<SocialPlatform, boolean> {
  return {
    x: config.distribution.platforms.x.liveGoArmed,
    instagram: config.distribution.platforms.instagram.liveGoArmed,
    tiktok: config.distribution.platforms.tiktok.liveGoArmed
  };
}

export class SocialDistributionWorker {
  async status(config?: Partial<ArtistRuntimeConfig>) {
    const resolved = applyConfigDefaults(config);
    const songs = await listSongStates(resolved.artist.workspaceRoot);
    const recentSong = songs[0];
    const lastAction = recentSong ? await readLatestSocialAction(resolved.artist.workspaceRoot, recentSong.songId) : undefined;
    const enabledPlatforms = (Object.entries(resolved.distribution.platforms) as Array<["x" | "instagram" | "tiktok", ArtistRuntimeConfig["distribution"]["platforms"]["x"] | ArtistRuntimeConfig["distribution"]["platforms"]["instagram"] | ArtistRuntimeConfig["distribution"]["platforms"]["tiktok"]]>)
      .filter(([, platform]) => platform.enabled)
      .map(([platform]) => platform);
    const today = new Date().toISOString().slice(0, 10);
    const postsToday = lastAction && lastAction.timestamp.slice(0, 10) === today && lastAction.action === "publish" ? 1 : 0;
    const repliesToday = lastAction && lastAction.timestamp.slice(0, 10) === today && lastAction.action === "reply" ? 1 : 0;
    const effectiveDryRun = buildEffectiveDryRun(resolved);
    const platformLiveGoArmed = buildPlatformLiveGoArmed(resolved);
    const enabledPlatformsArmed = enabledPlatforms.some((platform) => platformLiveGoArmed[platform]);

    let blockedReason: string | undefined;
    if (!resolved.distribution.enabled) {
      blockedReason = "distribution disabled";
    } else if (enabledPlatforms.length === 0) {
      blockedReason = "no enabled distribution platforms";
    } else if (resolved.autopilot.dryRun) {
      blockedReason = "dry-run prevents live distribution";
    } else if (!resolved.distribution.liveGoArmed) {
      blockedReason = "live-go arm is off";
    } else if (!enabledPlatformsArmed) {
      blockedReason = "no enabled platforms are armed";
    }

    return {
      enabled: resolved.distribution.enabled,
      dryRun: resolved.autopilot.dryRun,
      liveGoArmed: resolved.distribution.liveGoArmed,
      platformLiveGoArmed,
      effectiveDryRun,
      lastSongId: recentSong?.songId,
      lastAction,
      enabledPlatforms,
      blockedReason,
      postsToday,
      repliesToday
    };
  }
}
