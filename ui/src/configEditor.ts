import {
  producerDigestModes,
  instagramAuthorityModes,
  sunoDriverModes,
  sunoSubmitModes,
  tiktokAuthorityModes,
  xAuthorityModes,
  type InstagramAuthority,
  type ProducerDigestMode,
  type SunoDriverMode,
  type SunoSubmitMode,
  type TikTokAuthority,
  type UiLocaleMode,
  type XAuthority
} from "../../src/types";

export type ConfigEditorSource = {
  ui?: {
    locale?: UiLocaleMode;
  };
  music: {
    suno: {
      dailyCreditLimit: number;
      monthlyCreditLimit: number;
      monthlyGenerationBudget: number;
      maxGenerationsPerDay: number;
      minMinutesBetweenCreates: number;
      driver: SunoDriverMode;
      submitMode: SunoSubmitMode;
    };
  };
  autopilot: {
    enabled: boolean;
    dryRun: boolean;
    songsPerWeek: number;
    cycleIntervalMinutes: number;
    planningTimeoutDays: number;
    producerDigest: ProducerDigestMode;
  };
  distribution: {
    liveGoArmed: boolean;
    platforms: {
      x: { enabled: boolean; liveGoArmed: boolean; authority: XAuthority; maxPostsPerDay: number; maxRepliesPerDay: number };
      instagram: { enabled: boolean; liveGoArmed: boolean; authority: InstagramAuthority };
      tiktok: { enabled: boolean; liveGoArmed: boolean; authority: TikTokAuthority };
    };
  };
  songSpawn?: {
    enabled: boolean;
    minIntervalHours: number;
  };
};

export type ConfigDraft = {
  dailyCreditLimit: string;
  monthlyCreditLimit: string;
  monthlyGenerationBudget: string;
  maxGenerationsPerDay: string;
  minMinutesBetweenCreates: string;
  sunoDriver: SunoDriverMode;
  sunoSubmitMode: SunoSubmitMode;
  autopilotEnabled: boolean;
  dryRun: boolean;
  songsPerWeek: string;
  cycleIntervalMinutes: string;
  planningTimeoutDays: string;
  producerDigest: ProducerDigestMode;
  distributionLiveGoArmed: boolean;
  xEnabled: boolean;
  xLiveGoArmed: boolean;
  xAuthority: XAuthority;
  xMaxPostsPerDay: string;
  xMaxRepliesPerDay: string;
  instagramEnabled: boolean;
  instagramLiveGoArmed: boolean;
  instagramAuthority: InstagramAuthority;
  tiktokEnabled: boolean;
  tiktokLiveGoArmed: boolean;
  tiktokAuthority: TikTokAuthority;
  songSpawnEnabled: boolean;
  songSpawnMinIntervalHours: string;
  uiLocale: UiLocaleMode;
};

export type ConfigUpdatePatch = {
  ui: {
    locale: UiLocaleMode;
  };
  music: {
    suno: {
      dailyCreditLimit: number;
      monthlyCreditLimit: number;
      monthlyGenerationBudget: number;
      maxGenerationsPerDay: number;
      minMinutesBetweenCreates: number;
      driver: SunoDriverMode;
      submitMode: SunoSubmitMode;
    };
  };
  autopilot: {
    enabled: boolean;
    dryRun: boolean;
    songsPerWeek: number;
    cycleIntervalMinutes: number;
    planningTimeoutDays: number;
    producerDigest: ProducerDigestMode;
  };
  distribution: {
    liveGoArmed: boolean;
    platforms: {
      x: { enabled: boolean; liveGoArmed: boolean; authority: XAuthority; maxPostsPerDay: number; maxRepliesPerDay: number };
      instagram: { enabled: boolean; liveGoArmed: boolean; authority: InstagramAuthority };
      tiktok: { enabled: boolean; liveGoArmed: boolean; authority: TikTokAuthority };
    };
  };
  songSpawn: {
    enabled: boolean;
    minIntervalHours: number;
  };
};

function parseWholeNumber(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a whole number`);
  }
  return Number(trimmed);
}

export function buildConfigDraft(source: ConfigEditorSource): ConfigDraft {
  return {
    uiLocale: source.ui?.locale ?? "auto",
    dailyCreditLimit: String(source.music.suno.dailyCreditLimit),
    monthlyCreditLimit: String(source.music.suno.monthlyCreditLimit),
    monthlyGenerationBudget: String(source.music.suno.monthlyGenerationBudget ?? 50),
    maxGenerationsPerDay: String(source.music.suno.maxGenerationsPerDay ?? 4),
    minMinutesBetweenCreates: String(source.music.suno.minMinutesBetweenCreates ?? 20),
    sunoDriver: source.music.suno.driver,
    sunoSubmitMode: source.music.suno.submitMode,
    autopilotEnabled: source.autopilot.enabled,
    dryRun: source.autopilot.dryRun,
    songsPerWeek: String(source.autopilot.songsPerWeek),
    cycleIntervalMinutes: String(source.autopilot.cycleIntervalMinutes),
    planningTimeoutDays: String(source.autopilot.planningTimeoutDays ?? 7),
    producerDigest: source.autopilot.producerDigest ?? "daily",
    distributionLiveGoArmed: source.distribution.liveGoArmed,
    xEnabled: source.distribution.platforms.x.enabled,
    xLiveGoArmed: source.distribution.platforms.x.liveGoArmed,
    xAuthority: source.distribution.platforms.x.authority,
    xMaxPostsPerDay: String(source.distribution.platforms.x.maxPostsPerDay ?? 3),
    xMaxRepliesPerDay: String(source.distribution.platforms.x.maxRepliesPerDay ?? 0),
    instagramEnabled: source.distribution.platforms.instagram.enabled,
    instagramLiveGoArmed: source.distribution.platforms.instagram.liveGoArmed,
    instagramAuthority: source.distribution.platforms.instagram.authority,
    tiktokEnabled: source.distribution.platforms.tiktok.enabled,
    tiktokLiveGoArmed: source.distribution.platforms.tiktok.liveGoArmed,
    tiktokAuthority: source.distribution.platforms.tiktok.authority,
    songSpawnEnabled: source.songSpawn?.enabled ?? false,
    songSpawnMinIntervalHours: String(source.songSpawn?.minIntervalHours ?? 24)
  };
}

export function buildConfigUpdatePatch(draft: ConfigDraft): ConfigUpdatePatch {
  const dailyCreditLimit = parseWholeNumber(draft.dailyCreditLimit, "dailyCreditLimit");
  const monthlyCreditLimit = parseWholeNumber(draft.monthlyCreditLimit, "monthlyCreditLimit");
  const monthlyGenerationBudget = parseWholeNumber(draft.monthlyGenerationBudget, "monthlyGenerationBudget");
  const maxGenerationsPerDay = parseWholeNumber(draft.maxGenerationsPerDay, "maxGenerationsPerDay");
  const minMinutesBetweenCreates = parseWholeNumber(draft.minMinutesBetweenCreates, "minMinutesBetweenCreates");
  const songsPerWeek = parseWholeNumber(draft.songsPerWeek, "songsPerWeek");
  const cycleIntervalMinutes = parseWholeNumber(draft.cycleIntervalMinutes, "cycleIntervalMinutes");
  const planningTimeoutDays = parseWholeNumber(draft.planningTimeoutDays, "planningTimeoutDays");
  const xMaxPostsPerDay = parseWholeNumber(draft.xMaxPostsPerDay, "xMaxPostsPerDay");
  const xMaxRepliesPerDay = parseWholeNumber(draft.xMaxRepliesPerDay, "xMaxRepliesPerDay");
  const songSpawnMinIntervalHours = parseWholeNumber(draft.songSpawnMinIntervalHours, "songSpawnMinIntervalHours");

  if (dailyCreditLimit < 1 || dailyCreditLimit > 1000) {
    throw new Error("dailyCreditLimit must be between 1 and 1000");
  }

  if (monthlyCreditLimit < 0 || monthlyCreditLimit > 50000) {
    throw new Error("monthlyCreditLimit must be between 0 and 50000");
  }

  if (monthlyGenerationBudget < 0 || monthlyGenerationBudget > 1000) {
    throw new Error("monthlyGenerationBudget must be between 0 and 1000");
  }

  if (maxGenerationsPerDay < 0 || maxGenerationsPerDay > 100) {
    throw new Error("maxGenerationsPerDay must be between 0 and 100");
  }

  if (minMinutesBetweenCreates < 1 || minMinutesBetweenCreates > 1440) {
    throw new Error("minMinutesBetweenCreates must be between 1 and 1440");
  }

  if (songsPerWeek < 0 || songsPerWeek > 100) {
    throw new Error("songsPerWeek must be between 0 and 100");
  }

  if (cycleIntervalMinutes < 15 || cycleIntervalMinutes > 1440) {
    throw new Error("cycleIntervalMinutes must be between 15 and 1440");
  }

  if (planningTimeoutDays < 1 || planningTimeoutDays > 30) {
    throw new Error("planningTimeoutDays must be between 1 and 30");
  }

  if (!producerDigestModes.includes(draft.producerDigest)) {
    throw new Error("producerDigest must be one of the supported producer digest modes");
  }

  if (xMaxPostsPerDay < 0 || xMaxPostsPerDay > 50) {
    throw new Error("xMaxPostsPerDay must be between 0 and 50");
  }

  if (xMaxRepliesPerDay < 0 || xMaxRepliesPerDay > 200) {
    throw new Error("xMaxRepliesPerDay must be between 0 and 200");
  }

  if (songSpawnMinIntervalHours < 0 || songSpawnMinIntervalHours > 168) {
    throw new Error("songSpawnMinIntervalHours must be between 0 and 168");
  }

  if (!xAuthorityModes.includes(draft.xAuthority)) {
    throw new Error("xAuthority must be one of the supported X authority modes");
  }

  if (!instagramAuthorityModes.includes(draft.instagramAuthority)) {
    throw new Error("instagramAuthority must be one of the supported Instagram authority modes");
  }

  if (!tiktokAuthorityModes.includes(draft.tiktokAuthority)) {
    throw new Error("tiktokAuthority must be one of the supported TikTok authority modes");
  }

  if (!sunoDriverModes.includes(draft.sunoDriver)) {
    throw new Error("sunoDriver must be one of the supported Suno driver modes");
  }

  if (!sunoSubmitModes.includes(draft.sunoSubmitMode)) {
    throw new Error("sunoSubmitMode must be one of the supported Suno submit modes");
  }

  if (!["auto", "ja", "en"].includes(draft.uiLocale)) {
    throw new Error("uiLocale must be one of auto, ja, en");
  }

  return {
    ui: {
      locale: draft.uiLocale
    },
    music: {
      suno: {
        dailyCreditLimit,
        monthlyCreditLimit,
        monthlyGenerationBudget,
        maxGenerationsPerDay,
        minMinutesBetweenCreates,
        driver: draft.sunoDriver,
        submitMode: draft.sunoSubmitMode
      }
    },
    autopilot: {
      enabled: draft.autopilotEnabled,
      dryRun: draft.dryRun,
      songsPerWeek,
      cycleIntervalMinutes,
      planningTimeoutDays,
      producerDigest: draft.producerDigest
    },
    distribution: {
      liveGoArmed: draft.distributionLiveGoArmed,
      platforms: {
        x: { enabled: draft.xEnabled, liveGoArmed: draft.xLiveGoArmed, authority: draft.xAuthority, maxPostsPerDay: xMaxPostsPerDay, maxRepliesPerDay: xMaxRepliesPerDay },
        // Instagram is frozen by #4 boundary; arm flags are clamped to false even if the draft has them on.
        instagram: { enabled: draft.instagramEnabled, liveGoArmed: false, authority: draft.instagramAuthority },
        // TikTok stays frozen in the UI lane until the operator account exists.
        tiktok: { enabled: draft.tiktokEnabled, liveGoArmed: false, authority: draft.tiktokAuthority }
      }
    },
    songSpawn: {
      enabled: draft.songSpawnEnabled,
      minIntervalHours: songSpawnMinIntervalHours
    }
  };
}

export function validateConfigDraft(draft: ConfigDraft): string | null {
  try {
    buildConfigUpdatePatch(draft);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
