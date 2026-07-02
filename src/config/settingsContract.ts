import { defaultArtistRuntimeConfig } from "./defaultConfig.js";

export type SettingContractKind = "runtimeEffective" | "enforcedInvariant" | "deprecatedMigrated";

export interface SettingContractEntry {
  path: string;
  kind: SettingContractKind;
}

export const settingContract = [
  { path: "schemaVersion", kind: "runtimeEffective" },
  { path: "artist.mode", kind: "runtimeEffective" },
  { path: "artist.artistId", kind: "runtimeEffective" },
  { path: "artist.profilePath", kind: "runtimeEffective" },
  { path: "artist.workspaceRoot", kind: "runtimeEffective" },
  { path: "artist.identity.displayName", kind: "runtimeEffective" },
  { path: "artist.identity.producerCallname", kind: "runtimeEffective" },
  { path: "autopilot.enabled", kind: "runtimeEffective" },
  { path: "autopilot.dryRun", kind: "runtimeEffective" },
  { path: "autopilot.songsPerWeek", kind: "runtimeEffective" },
  { path: "autopilot.cycleIntervalMinutes", kind: "runtimeEffective" },
  { path: "autopilot.planningTimeoutDays", kind: "runtimeEffective" },
  { path: "autopilot.producerDigest", kind: "runtimeEffective" },
  { path: "dashboard.baseUrl", kind: "runtimeEffective" },
  { path: "music.engine", kind: "runtimeEffective" },
  { path: "music.suno.enabled", kind: "runtimeEffective" },
  { path: "music.suno.connectionMode", kind: "runtimeEffective" },
  { path: "music.suno.driver", kind: "runtimeEffective" },
  { path: "music.suno.submitMode", kind: "runtimeEffective" },
  { path: "music.suno.authority", kind: "runtimeEffective" },
  { path: "music.suno.dailyCreditLimit", kind: "runtimeEffective" },
  { path: "music.suno.monthlyCreditLimit", kind: "runtimeEffective" },
  { path: "music.suno.monthlyGenerationBudget", kind: "runtimeEffective" },
  { path: "music.suno.maxGenerationsPerDay", kind: "runtimeEffective" },
  { path: "music.suno.minMinutesBetweenCreates", kind: "runtimeEffective" },
  { path: "music.suno.stopOnLoginChallenge", kind: "enforcedInvariant" },
  { path: "music.suno.stopOnCaptcha", kind: "enforcedInvariant" },
  { path: "music.suno.stopOnPaymentPrompt", kind: "enforcedInvariant" },
  { path: "music.suno.promptLogging", kind: "runtimeEffective" },
  { path: "distribution.enabled", kind: "runtimeEffective" },
  { path: "distribution.liveGoArmed", kind: "runtimeEffective" },
  { path: "distribution.dailySharing", kind: "runtimeEffective" },
  { path: "distribution.officialRelease", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.enabled", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.liveGoArmed", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.authStatus", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.lastTestedAt", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.connector", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.authority", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.maxPostsPerDay", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.maxRepliesPerDay", kind: "runtimeEffective" },
  { path: "distribution.platforms.x.autoPostTypes", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.enabled", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.liveGoArmed", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.authStatus", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.lastTestedAt", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.liveRehearsalArmed", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.accessTokenExpiresAt", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.connector", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.authority", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.maxPostsPerDay", kind: "runtimeEffective" },
  { path: "distribution.platforms.instagram.autoPostTypes", kind: "runtimeEffective" },
  { path: "distribution.platforms.tiktok.enabled", kind: "runtimeEffective" },
  { path: "distribution.platforms.tiktok.liveGoArmed", kind: "runtimeEffective" },
  { path: "distribution.platforms.tiktok.authStatus", kind: "runtimeEffective" },
  { path: "distribution.platforms.tiktok.lastTestedAt", kind: "runtimeEffective" },
  { path: "distribution.platforms.tiktok.connector", kind: "runtimeEffective" },
  { path: "distribution.platforms.tiktok.authority", kind: "runtimeEffective" },
  { path: "distribution.platforms.tiktok.maxPostsPerDay", kind: "runtimeEffective" },
  { path: "distribution.platforms.tiktok.autoPostTypes", kind: "runtimeEffective" },
  { path: "telegram.enabled", kind: "runtimeEffective" },
  { path: "telegram.pollIntervalMs", kind: "runtimeEffective" },
  { path: "telegram.notifyStages", kind: "runtimeEffective" },
  { path: "telegram.acceptFreeText", kind: "runtimeEffective" },
  { path: "artistPulse.enabled", kind: "runtimeEffective" },
  { path: "artistPulse.minIntervalHours", kind: "runtimeEffective" },
  { path: "commission.enabled", kind: "runtimeEffective" },
  { path: "songSpawn.enabled", kind: "runtimeEffective" },
  { path: "songSpawn.minIntervalHours", kind: "runtimeEffective" },
  { path: "observation.newsRssUrls", kind: "runtimeEffective" },
  { path: "aiReview.provider", kind: "runtimeEffective" },
  { path: "ui.locale", kind: "runtimeEffective" },
  { path: "safety.auditLog", kind: "runtimeEffective" },
  { path: "safety.failClosed", kind: "runtimeEffective" },
  { path: "safety.forbiddenTopics", kind: "runtimeEffective" },
  { path: "safety.forbidCaptchaBypass", kind: "enforcedInvariant" },
  { path: "safety.forbidCredentialLogging", kind: "enforcedInvariant" },
  { path: "safety.requireApprovalForHighRisk", kind: "enforcedInvariant" }
] as const satisfies readonly SettingContractEntry[];

export function defaultConfigLeafPaths(value: unknown = defaultArtistRuntimeConfig, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return defaultConfigLeafPaths(child, path);
  });
}
