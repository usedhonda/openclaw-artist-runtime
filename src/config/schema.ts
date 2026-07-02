import { defaultArtistRuntimeConfig } from "./defaultConfig.js";
import { CURRENT_CONFIG_SCHEMA_VERSION, migrateConfig } from "./migrations.js";
import {
  dailySharingModes,
  aiReviewProviders,
  instagramAuthorityModes,
  officialReleaseModes,
  platformAuthStatuses,
  producerDigestModes,
  sunoAuthorityModes,
  sunoConnectionModes,
  sunoDriverModes,
  sunoSubmitModes,
  tiktokAuthorityModes,
  uiLocaleModes,
  type ArtistRuntimeConfig,
  type ValidationResult,
  xAuthorityModes
} from "../types.js";

type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends string[] ? string[] : T[K] extends Record<string, unknown> ? PartialDeep<T[K]> : T[K];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function validateKnownKeys(path: string, record: Record<string, unknown>, allowed: readonly string[], errors: string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      errors.push(`${path}.${key} is not allowed`);
    }
  }
}

function validateEnum(path: string, value: unknown, allowed: readonly string[], errors: string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${path} must be one of ${allowed.join(", ")}`);
  }
}

function validateTimestamp(path: string, value: unknown, errors: string[]): void {
  const max = Date.now() + 24 * 60 * 60 * 1000;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) {
    errors.push(`${path} must be an integer between 0 and now+1d`);
  }
}

function validateNonNegativeInteger(path: string, value: unknown, errors: string[]): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    errors.push(`${path} must be a non-negative integer`);
  }
}

function validateStringArray(path: string, value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${path} must be an array of strings`);
  }
}

function validateNonEmptyStringArray(path: string, value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    errors.push(`${path} must be an array of non-empty strings`);
  }
}

export function applyConfigDefaults(config?: PartialDeep<ArtistRuntimeConfig>): ArtistRuntimeConfig {
  const merged = structuredClone(defaultArtistRuntimeConfig);
  if (!config) {
    return enforceConfigInvariants(merged);
  }

  if (config.schemaVersion !== undefined) {
    merged.schemaVersion = config.schemaVersion;
  }

  if (config.artist) {
    Object.assign(merged.artist, config.artist);
  }
  if (config.autopilot) {
    Object.assign(merged.autopilot, config.autopilot);
  }
  if (config.dashboard) {
    Object.assign(merged.dashboard, config.dashboard);
  }
  if (config.music) {
    if (config.music.engine !== undefined) {
      merged.music.engine = config.music.engine;
    }
    if (config.music.suno) {
      Object.assign(merged.music.suno, config.music.suno);
    }
  }
  if (config.distribution) {
    if (config.distribution.enabled !== undefined) {
      merged.distribution.enabled = config.distribution.enabled;
    }
    if (config.distribution.liveGoArmed !== undefined) {
      merged.distribution.liveGoArmed = config.distribution.liveGoArmed;
    }
    if (config.distribution.dailySharing !== undefined) {
      merged.distribution.dailySharing = config.distribution.dailySharing;
    }
    if (config.distribution.officialRelease !== undefined) {
      merged.distribution.officialRelease = config.distribution.officialRelease;
    }
    if (config.distribution.platforms) {
      if (config.distribution.platforms.x) {
        Object.assign(merged.distribution.platforms.x, config.distribution.platforms.x);
      }
      if (config.distribution.platforms.instagram) {
        Object.assign(merged.distribution.platforms.instagram, config.distribution.platforms.instagram);
      }
      if (config.distribution.platforms.tiktok) {
        Object.assign(merged.distribution.platforms.tiktok, config.distribution.platforms.tiktok);
      }
    }
  }
  if (config.telegram) {
    Object.assign(merged.telegram, config.telegram);
  }
  if (config.artistPulse) {
    Object.assign(merged.artistPulse, config.artistPulse);
  }
  if (config.commission) {
    Object.assign(merged.commission, config.commission);
  }
  if (config.songSpawn) {
    Object.assign(merged.songSpawn, config.songSpawn);
  }
  if (config.observation) {
    Object.assign(merged.observation, config.observation);
  }
  if (config.aiReview) {
    Object.assign(merged.aiReview, config.aiReview);
  }
  if (config.ui) {
    Object.assign(merged.ui, config.ui);
  }
  if (config.safety) {
    Object.assign(merged.safety, config.safety);
  }

  return enforceConfigInvariants(merged);
}

function enforceConfigInvariants(config: ArtistRuntimeConfig): ArtistRuntimeConfig {
  config.music.suno.stopOnLoginChallenge = true;
  config.music.suno.stopOnCaptcha = true;
  config.music.suno.stopOnPaymentPrompt = true;
  config.music.suno.promptLogging = "full";
  config.safety.forbidCaptchaBypass = true;
  config.safety.forbidCredentialLogging = true;
  config.safety.requireApprovalForHighRisk = true;
  return config;
}

export function validateConfig(config: unknown): ValidationResult<ArtistRuntimeConfig> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(config)) {
    return { ok: false, errors: ["config must be an object"], warnings };
  }

  validateKnownKeys("config", config, ["schemaVersion", "artist", "autopilot", "dashboard", "music", "distribution", "telegram", "artistPulse", "commission", "songSpawn", "observation", "aiReview", "ui", "safety"], errors);

  if ("schemaVersion" in config && !isIntegerInRange(config.schemaVersion, 1, CURRENT_CONFIG_SCHEMA_VERSION)) {
    errors.push(`config.schemaVersion must be an integer between 1 and ${CURRENT_CONFIG_SCHEMA_VERSION}`);
  }

  if ("artist" in config) {
    if (!isRecord(config.artist)) {
      errors.push("config.artist must be an object");
    } else {
      validateKnownKeys("config.artist", config.artist, ["mode", "artistId", "profilePath", "workspaceRoot", "identity"], errors);
      if (!("mode" in config.artist)) {
        errors.push("config.artist.mode is required when config.artist is present");
      } else if (config.artist.mode !== "public_artist") {
        errors.push("config.artist.mode must be public_artist");
      }
      if ("artistId" in config.artist && typeof config.artist.artistId !== "string") {
        errors.push("config.artist.artistId must be a string");
      }
      if ("profilePath" in config.artist && typeof config.artist.profilePath !== "string") {
        errors.push("config.artist.profilePath must be a string");
      }
      if ("workspaceRoot" in config.artist && typeof config.artist.workspaceRoot !== "string") {
        errors.push("config.artist.workspaceRoot must be a string");
      }
      if ("identity" in config.artist) {
        if (!isRecord(config.artist.identity)) {
          errors.push("config.artist.identity must be an object");
        } else {
          validateKnownKeys("config.artist.identity", config.artist.identity, ["displayName", "producerCallname"], errors);
          if ("displayName" in config.artist.identity && typeof config.artist.identity.displayName !== "string") {
            errors.push("config.artist.identity.displayName must be a string");
          }
          if ("producerCallname" in config.artist.identity && typeof config.artist.identity.producerCallname !== "string") {
            errors.push("config.artist.identity.producerCallname must be a string");
          }
        }
      }
    }
  }

  if ("autopilot" in config) {
    if (!isRecord(config.autopilot)) {
      errors.push("config.autopilot must be an object");
    } else {
      validateKnownKeys("config.autopilot", config.autopilot, ["enabled", "dryRun", "songsPerWeek", "cycleIntervalMinutes", "planningTimeoutDays", "producerDigest"], errors);
      if ("enabled" in config.autopilot && typeof config.autopilot.enabled !== "boolean") {
        errors.push("config.autopilot.enabled must be a boolean");
      }
      if ("dryRun" in config.autopilot && typeof config.autopilot.dryRun !== "boolean") {
        errors.push("config.autopilot.dryRun must be a boolean");
      }
      if ("songsPerWeek" in config.autopilot && !isIntegerInRange(config.autopilot.songsPerWeek, 0, 100)) {
        errors.push("config.autopilot.songsPerWeek must be an integer between 0 and 100");
      }
      if ("cycleIntervalMinutes" in config.autopilot && !isIntegerInRange(config.autopilot.cycleIntervalMinutes, 15, 1440)) {
        errors.push("config.autopilot.cycleIntervalMinutes must be an integer between 15 and 1440");
      }
      if ("planningTimeoutDays" in config.autopilot && !isIntegerInRange(config.autopilot.planningTimeoutDays, 1, 30)) {
        errors.push("config.autopilot.planningTimeoutDays must be an integer between 1 and 30");
      }
      if ("producerDigest" in config.autopilot) {
        validateEnum("config.autopilot.producerDigest", config.autopilot.producerDigest, producerDigestModes, errors);
      }
    }
  }

  if ("dashboard" in config) {
    if (!isRecord(config.dashboard)) {
      errors.push("config.dashboard must be an object");
    } else {
      validateKnownKeys("config.dashboard", config.dashboard, ["baseUrl"], errors);
      if ("baseUrl" in config.dashboard && typeof config.dashboard.baseUrl !== "string") {
        errors.push("config.dashboard.baseUrl must be a string");
      }
    }
  }

  if ("music" in config) {
    if (!isRecord(config.music)) {
      errors.push("config.music must be an object");
    } else {
      validateKnownKeys("config.music", config.music, ["engine", "suno"], errors);
      if ("engine" in config.music) {
        validateEnum("config.music.engine", config.music.engine, ["suno"], errors);
      }
      if ("suno" in config.music) {
        if (!isRecord(config.music.suno)) {
          errors.push("config.music.suno must be an object");
        } else {
          validateKnownKeys(
            "config.music.suno",
            config.music.suno,
            [
              "enabled",
              "connectionMode",
              "driver",
              "submitMode",
              "authority",
              "dailyCreditLimit",
              "monthlyCreditLimit",
              "monthlyGenerationBudget",
              "maxGenerationsPerDay",
              "minMinutesBetweenCreates",
              "stopOnLoginChallenge",
              "stopOnCaptcha",
              "stopOnPaymentPrompt",
              "promptLogging"
            ],
            errors
          );
          if ("enabled" in config.music.suno && typeof config.music.suno.enabled !== "boolean") {
            errors.push("config.music.suno.enabled must be a boolean");
          }
          if ("connectionMode" in config.music.suno) {
            validateEnum("config.music.suno.connectionMode", config.music.suno.connectionMode, sunoConnectionModes, errors);
          }
          if ("driver" in config.music.suno) {
            validateEnum("config.music.suno.driver", config.music.suno.driver, sunoDriverModes, errors);
          }
          if ("submitMode" in config.music.suno) {
            validateEnum("config.music.suno.submitMode", config.music.suno.submitMode, sunoSubmitModes, errors);
          }
          if ("authority" in config.music.suno) {
            validateEnum("config.music.suno.authority", config.music.suno.authority, sunoAuthorityModes, errors);
          }
          if ("dailyCreditLimit" in config.music.suno && !isIntegerInRange(config.music.suno.dailyCreditLimit, 1, 1000)) {
            errors.push("config.music.suno.dailyCreditLimit must be an integer between 1 and 1000");
          }
          if ("monthlyCreditLimit" in config.music.suno && !isIntegerInRange(config.music.suno.monthlyCreditLimit, 0, 50000)) {
            errors.push("config.music.suno.monthlyCreditLimit must be an integer between 0 and 50000");
          }
          if ("monthlyGenerationBudget" in config.music.suno && !isIntegerInRange(config.music.suno.monthlyGenerationBudget, 0, 1000)) {
            errors.push("config.music.suno.monthlyGenerationBudget must be an integer between 0 and 1000");
          }
          if ("maxGenerationsPerDay" in config.music.suno && !isIntegerInRange(config.music.suno.maxGenerationsPerDay, 0, 100)) {
            errors.push("config.music.suno.maxGenerationsPerDay must be an integer between 0 and 100");
          }
          if ("minMinutesBetweenCreates" in config.music.suno && !isIntegerInRange(config.music.suno.minMinutesBetweenCreates, 1, 1440)) {
            errors.push("config.music.suno.minMinutesBetweenCreates must be an integer between 1 and 1440");
          }
          if ("stopOnLoginChallenge" in config.music.suno && typeof config.music.suno.stopOnLoginChallenge !== "boolean") {
            errors.push("config.music.suno.stopOnLoginChallenge must be a boolean");
          }
          if ("stopOnCaptcha" in config.music.suno && typeof config.music.suno.stopOnCaptcha !== "boolean") {
            errors.push("config.music.suno.stopOnCaptcha must be a boolean");
          }
          if ("stopOnPaymentPrompt" in config.music.suno && typeof config.music.suno.stopOnPaymentPrompt !== "boolean") {
            errors.push("config.music.suno.stopOnPaymentPrompt must be a boolean");
          }
          if ("promptLogging" in config.music.suno) {
            validateEnum("config.music.suno.promptLogging", config.music.suno.promptLogging, ["full"], errors);
          }
        }
      }
    }
  }

  if ("distribution" in config) {
    if (!isRecord(config.distribution)) {
      errors.push("config.distribution must be an object");
    } else {
      validateKnownKeys("config.distribution", config.distribution, ["enabled", "liveGoArmed", "dailySharing", "officialRelease", "platforms"], errors);
      if ("enabled" in config.distribution && typeof config.distribution.enabled !== "boolean") {
        errors.push("config.distribution.enabled must be a boolean");
      }
      if ("liveGoArmed" in config.distribution && typeof config.distribution.liveGoArmed !== "boolean") {
        errors.push("config.distribution.liveGoArmed must be a boolean");
      }
      if ("dailySharing" in config.distribution) {
        validateEnum("config.distribution.dailySharing", config.distribution.dailySharing, dailySharingModes, errors);
      }
      if ("officialRelease" in config.distribution) {
        validateEnum("config.distribution.officialRelease", config.distribution.officialRelease, officialReleaseModes, errors);
      }
      if ("platforms" in config.distribution) {
        if (!isRecord(config.distribution.platforms)) {
          errors.push("config.distribution.platforms must be an object");
        } else {
          validateKnownKeys("config.distribution.platforms", config.distribution.platforms, ["x", "instagram", "tiktok"], errors);
          if ("x" in config.distribution.platforms) {
            validateXPlatform(config.distribution.platforms.x, errors);
          }
          if ("instagram" in config.distribution.platforms) {
            validateInstagramPlatform(config.distribution.platforms.instagram, errors);
          }
          if ("tiktok" in config.distribution.platforms) {
            validateTikTokPlatform(config.distribution.platforms.tiktok, errors);
          }
        }
      }
    }
  }

  if ("telegram" in config) {
    if (!isRecord(config.telegram)) {
      errors.push("config.telegram must be an object");
    } else {
      validateKnownKeys("config.telegram", config.telegram, ["enabled", "pollIntervalMs", "notifyStages", "acceptFreeText"], errors);
      if ("enabled" in config.telegram && typeof config.telegram.enabled !== "boolean") {
        errors.push("config.telegram.enabled must be a boolean");
      }
      if ("pollIntervalMs" in config.telegram && !isIntegerInRange(config.telegram.pollIntervalMs, 500, 60000)) {
        errors.push("config.telegram.pollIntervalMs must be an integer between 500 and 60000");
      }
      if ("notifyStages" in config.telegram && typeof config.telegram.notifyStages !== "boolean") {
        errors.push("config.telegram.notifyStages must be a boolean");
      }
      if ("acceptFreeText" in config.telegram && typeof config.telegram.acceptFreeText !== "boolean") {
        errors.push("config.telegram.acceptFreeText must be a boolean");
      }
    }
  }

  if ("artistPulse" in config) {
    if (!isRecord(config.artistPulse)) {
      errors.push("config.artistPulse must be an object");
    } else {
      validateKnownKeys("config.artistPulse", config.artistPulse, ["enabled", "minIntervalHours"], errors);
      if ("enabled" in config.artistPulse && typeof config.artistPulse.enabled !== "boolean") {
        errors.push("config.artistPulse.enabled must be a boolean");
      }
      if ("minIntervalHours" in config.artistPulse && !isIntegerInRange(config.artistPulse.minIntervalHours, 6, 168)) {
        errors.push("config.artistPulse.minIntervalHours must be an integer between 6 and 168");
      }
    }
  }

  if ("commission" in config) {
    if (!isRecord(config.commission)) {
      errors.push("config.commission must be an object");
    } else {
      validateKnownKeys("config.commission", config.commission, ["enabled"], errors);
      if ("enabled" in config.commission && typeof config.commission.enabled !== "boolean") {
        errors.push("config.commission.enabled must be a boolean");
      }
    }
  }

  if ("songSpawn" in config) {
    if (!isRecord(config.songSpawn)) {
      errors.push("config.songSpawn must be an object");
    } else {
      validateKnownKeys("config.songSpawn", config.songSpawn, ["enabled", "minIntervalHours"], errors);
      if ("enabled" in config.songSpawn && typeof config.songSpawn.enabled !== "boolean") {
        errors.push("config.songSpawn.enabled must be a boolean");
      }
      if ("minIntervalHours" in config.songSpawn && !isIntegerInRange(config.songSpawn.minIntervalHours, 12, 168)) {
        errors.push("config.songSpawn.minIntervalHours must be an integer between 12 and 168");
      }
    }
  }

  if ("observation" in config) {
    if (!isRecord(config.observation)) {
      errors.push("config.observation must be an object");
    } else {
      validateKnownKeys("config.observation", config.observation, ["newsRssUrls"], errors);
      if ("newsRssUrls" in config.observation) {
        validateNonEmptyStringArray("config.observation.newsRssUrls", config.observation.newsRssUrls, errors);
      }
    }
  }

  if ("aiReview" in config) {
    if (!isRecord(config.aiReview)) {
      errors.push("config.aiReview must be an object");
    } else {
      validateKnownKeys("config.aiReview", config.aiReview, ["provider"], errors);
      if ("provider" in config.aiReview) {
        validateEnum("config.aiReview.provider", config.aiReview.provider, aiReviewProviders, errors);
      }
    }
  }

  if ("ui" in config) {
    if (!isRecord(config.ui)) {
      errors.push("config.ui must be an object");
    } else {
      validateKnownKeys("config.ui", config.ui, ["locale"], errors);
      if ("locale" in config.ui) {
        validateEnum("config.ui.locale", config.ui.locale, uiLocaleModes, errors);
      }
    }
  }

  if ("safety" in config) {
    if (!isRecord(config.safety)) {
      errors.push("config.safety must be an object");
    } else {
      validateKnownKeys(
        "config.safety",
        config.safety,
        ["auditLog", "failClosed", "forbiddenTopics", "forbidCaptchaBypass", "forbidCredentialLogging", "requireApprovalForHighRisk"],
        errors
      );
      if ("auditLog" in config.safety && typeof config.safety.auditLog !== "boolean") {
        errors.push("config.safety.auditLog must be a boolean");
      }
      if ("failClosed" in config.safety && typeof config.safety.failClosed !== "boolean") {
        errors.push("config.safety.failClosed must be a boolean");
      }
      if ("forbiddenTopics" in config.safety) {
        validateStringArray("config.safety.forbiddenTopics", config.safety.forbiddenTopics, errors);
      }
      if ("forbidCaptchaBypass" in config.safety && typeof config.safety.forbidCaptchaBypass !== "boolean") {
        errors.push("config.safety.forbidCaptchaBypass must be a boolean");
      }
      if ("forbidCredentialLogging" in config.safety && typeof config.safety.forbidCredentialLogging !== "boolean") {
        errors.push("config.safety.forbidCredentialLogging must be a boolean");
      }
      if ("requireApprovalForHighRisk" in config.safety && typeof config.safety.requireApprovalForHighRisk !== "boolean") {
        errors.push("config.safety.requireApprovalForHighRisk must be a boolean");
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const value = applyConfigDefaults(migrateConfig(config) as PartialDeep<ArtistRuntimeConfig>);
  appendConfigWarnings(value, warnings);
  return { ok: true, errors: [], warnings, value };
}

function appendConfigWarnings(config: ArtistRuntimeConfig, warnings: string[]): void {
  for (const platform of ["x", "instagram", "tiktok"] as const) {
    const platformConfig = config.distribution.platforms[platform];
    if (platformConfig.liveGoArmed && !config.distribution.liveGoArmed) {
      warnings.push(`config.distribution.platforms.${platform}.liveGoArmed is true while config.distribution.liveGoArmed is false`);
    }
    if (platformConfig.maxPostsPerDay > 0 && !platformConfig.enabled) {
      warnings.push(`config.distribution.platforms.${platform}.maxPostsPerDay is positive while platform is disabled`);
    }
  }
}

function validateXPlatform(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("config.distribution.platforms.x must be an object");
    return;
  }
  validateKnownKeys("config.distribution.platforms.x", value, ["enabled", "liveGoArmed", "authStatus", "lastTestedAt", "connector", "authority", "maxPostsPerDay", "maxRepliesPerDay", "autoPostTypes"], errors);
  if ("enabled" in value && typeof value.enabled !== "boolean") {
    errors.push("config.distribution.platforms.x.enabled must be a boolean");
  }
  if ("liveGoArmed" in value && typeof value.liveGoArmed !== "boolean") {
    errors.push("config.distribution.platforms.x.liveGoArmed must be a boolean");
  }
  if ("authStatus" in value) {
    validateEnum("config.distribution.platforms.x.authStatus", value.authStatus, platformAuthStatuses, errors);
  }
  if ("lastTestedAt" in value) {
    validateTimestamp("config.distribution.platforms.x.lastTestedAt", value.lastTestedAt, errors);
  }
  if ("connector" in value && value.connector !== "bird") {
    errors.push("config.distribution.platforms.x.connector must be bird");
  }
  if ("authority" in value) {
    validateEnum("config.distribution.platforms.x.authority", value.authority, xAuthorityModes, errors);
  }
  if ("maxPostsPerDay" in value && !isIntegerInRange(value.maxPostsPerDay, 0, 50)) {
    errors.push("config.distribution.platforms.x.maxPostsPerDay must be an integer between 0 and 50");
  }
  if ("maxRepliesPerDay" in value && !isIntegerInRange(value.maxRepliesPerDay, 0, 200)) {
    errors.push("config.distribution.platforms.x.maxRepliesPerDay must be an integer between 0 and 200");
  }
  if ("autoPostTypes" in value) {
    validateStringArray("config.distribution.platforms.x.autoPostTypes", value.autoPostTypes, errors);
  }
}

function validateInstagramPlatform(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("config.distribution.platforms.instagram must be an object");
    return;
  }
  validateKnownKeys("config.distribution.platforms.instagram", value, ["enabled", "liveGoArmed", "authStatus", "lastTestedAt", "liveRehearsalArmed", "accessTokenExpiresAt", "connector", "authority", "maxPostsPerDay", "autoPostTypes"], errors);
  if ("enabled" in value && typeof value.enabled !== "boolean") {
    errors.push("config.distribution.platforms.instagram.enabled must be a boolean");
  }
  if ("liveGoArmed" in value && typeof value.liveGoArmed !== "boolean") {
    errors.push("config.distribution.platforms.instagram.liveGoArmed must be a boolean");
  }
  if ("authStatus" in value) {
    validateEnum("config.distribution.platforms.instagram.authStatus", value.authStatus, platformAuthStatuses, errors);
  }
  if ("lastTestedAt" in value) {
    validateTimestamp("config.distribution.platforms.instagram.lastTestedAt", value.lastTestedAt, errors);
  }
  if ("liveRehearsalArmed" in value && typeof value.liveRehearsalArmed !== "boolean") {
    errors.push("config.distribution.platforms.instagram.liveRehearsalArmed must be a boolean");
  }
  if ("accessTokenExpiresAt" in value) {
    validateNonNegativeInteger("config.distribution.platforms.instagram.accessTokenExpiresAt", value.accessTokenExpiresAt, errors);
  }
  if ("connector" in value && value.connector !== "instagram_content_publishing") {
    errors.push("config.distribution.platforms.instagram.connector must be instagram_content_publishing");
  }
  if ("authority" in value) {
    validateEnum("config.distribution.platforms.instagram.authority", value.authority, instagramAuthorityModes, errors);
  }
  if ("maxPostsPerDay" in value && !isIntegerInRange(value.maxPostsPerDay, 0, 20)) {
    errors.push("config.distribution.platforms.instagram.maxPostsPerDay must be an integer between 0 and 20");
  }
  if ("autoPostTypes" in value) {
    validateStringArray("config.distribution.platforms.instagram.autoPostTypes", value.autoPostTypes, errors);
  }
}

function validateTikTokPlatform(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("config.distribution.platforms.tiktok must be an object");
    return;
  }
  validateKnownKeys("config.distribution.platforms.tiktok", value, ["enabled", "liveGoArmed", "authStatus", "lastTestedAt", "connector", "authority", "maxPostsPerDay", "autoPostTypes"], errors);
  if ("enabled" in value && typeof value.enabled !== "boolean") {
    errors.push("config.distribution.platforms.tiktok.enabled must be a boolean");
  }
  if ("liveGoArmed" in value && typeof value.liveGoArmed !== "boolean") {
    errors.push("config.distribution.platforms.tiktok.liveGoArmed must be a boolean");
  }
  if ("authStatus" in value) {
    validateEnum("config.distribution.platforms.tiktok.authStatus", value.authStatus, platformAuthStatuses, errors);
  }
  if ("lastTestedAt" in value) {
    validateTimestamp("config.distribution.platforms.tiktok.lastTestedAt", value.lastTestedAt, errors);
  }
  if ("connector" in value && value.connector !== "tiktok_content_posting") {
    errors.push("config.distribution.platforms.tiktok.connector must be tiktok_content_posting");
  }
  if ("authority" in value) {
    validateEnum("config.distribution.platforms.tiktok.authority", value.authority, tiktokAuthorityModes, errors);
  }
  if ("maxPostsPerDay" in value && !isIntegerInRange(value.maxPostsPerDay, 0, 20)) {
    errors.push("config.distribution.platforms.tiktok.maxPostsPerDay must be an integer between 0 and 20");
  }
  if ("autoPostTypes" in value) {
    validateStringArray("config.distribution.platforms.tiktok.autoPostTypes", value.autoPostTypes, errors);
  }
}
