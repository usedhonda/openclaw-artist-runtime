import type { ArtistRuntimeConfig } from "../types.js";

export const CURRENT_CONFIG_SCHEMA_VERSION = 1;

type ConfigRecord = Partial<ArtistRuntimeConfig> & Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migrateConfig(config: unknown): Partial<ArtistRuntimeConfig> {
  if (!isRecord(config)) {
    return { schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION };
  }

  const version = typeof config.schemaVersion === "number" ? config.schemaVersion : 1;
  if (!Number.isInteger(version) || version < 1) {
    return {
      ...config,
      schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION
    };
  }
  if (version > CURRENT_CONFIG_SCHEMA_VERSION) {
    throw new Error(`config schemaVersion ${version} is newer than supported ${CURRENT_CONFIG_SCHEMA_VERSION}`);
  }

  return migrateV1ToCurrent(config);
}

function migrateV1ToCurrent(config: ConfigRecord): Partial<ArtistRuntimeConfig> {
  const music = config.music?.suno
    ? {
        ...config.music,
        suno: {
          ...config.music.suno,
          stopOnLoginChallenge: true,
          stopOnCaptcha: true,
          stopOnPaymentPrompt: true,
          promptLogging: "full" as const
        }
      }
    : config.music;
  return {
    ...config,
    music,
    safety: config.safety ? {
      ...config.safety,
      forbidCaptchaBypass: true,
      forbidCredentialLogging: true,
      requireApprovalForHighRisk: true
    } : config.safety,
    schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION
  };
}

export function mockV1ToV2AddSchemaVersion(config: ConfigRecord): ConfigRecord {
  return {
    ...config,
    schemaVersion: 2
  };
}

export function mockV2ToV3RenamePattern(config: ConfigRecord): ConfigRecord {
  const next: ConfigRecord = { ...config, schemaVersion: 3 };
  const legacyArtistId = next["legacyArtistId"];
  if (typeof legacyArtistId === "string" && !next.artist) {
    next.artist = {
      mode: "public_artist",
      artistId: legacyArtistId,
      profilePath: "ARTIST.md",
      workspaceRoot: ".",
      identity: {}
    };
    delete next["legacyArtistId"];
  }
  return next;
}
