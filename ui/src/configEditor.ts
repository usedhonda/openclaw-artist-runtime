import {
  instagramAuthorityModes,
  sunoDriverModes,
  sunoSubmitModes,
  tiktokAuthorityModes,
  xAuthorityModes,
  type InstagramAuthority,
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
      driver: SunoDriverMode;
      submitMode: SunoSubmitMode;
    };
  };
  autopilot: {
    enabled: boolean;
    dryRun: boolean;
    songsPerWeek: number;
    cycleIntervalMinutes: number;
  };
  distribution: {
    liveGoArmed: boolean;
    platforms: {
      x: { enabled: boolean; liveGoArmed: boolean; authority: XAuthority };
      instagram: { enabled: boolean; liveGoArmed: boolean; authority: InstagramAuthority };
      tiktok: { enabled: boolean; liveGoArmed: boolean; authority: TikTokAuthority };
    };
  };
};

export type ConfigDraft = {
  dailyCreditLimit: string;
  monthlyCreditLimit: string;
  sunoDriver: SunoDriverMode;
  sunoSubmitMode: SunoSubmitMode;
  autopilotEnabled: boolean;
  dryRun: boolean;
  songsPerWeek: string;
  cycleIntervalMinutes: string;
  distributionLiveGoArmed: boolean;
  xEnabled: boolean;
  xLiveGoArmed: boolean;
  xAuthority: XAuthority;
  instagramEnabled: boolean;
  instagramLiveGoArmed: boolean;
  instagramAuthority: InstagramAuthority;
  tiktokEnabled: boolean;
  tiktokLiveGoArmed: boolean;
  tiktokAuthority: TikTokAuthority;
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
      driver: SunoDriverMode;
      submitMode: SunoSubmitMode;
    };
  };
  autopilot: {
    enabled: boolean;
    dryRun: boolean;
    songsPerWeek: number;
    cycleIntervalMinutes: number;
  };
  distribution: {
    liveGoArmed: boolean;
    platforms: {
      x: { enabled: boolean; liveGoArmed: boolean; authority: XAuthority };
      instagram: { enabled: boolean; liveGoArmed: boolean; authority: InstagramAuthority };
      tiktok: { enabled: boolean; liveGoArmed: boolean; authority: TikTokAuthority };
    };
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
    sunoDriver: source.music.suno.driver,
    sunoSubmitMode: source.music.suno.submitMode,
    autopilotEnabled: source.autopilot.enabled,
    dryRun: source.autopilot.dryRun,
    songsPerWeek: String(source.autopilot.songsPerWeek),
    cycleIntervalMinutes: String(source.autopilot.cycleIntervalMinutes),
    distributionLiveGoArmed: source.distribution.liveGoArmed,
    xEnabled: source.distribution.platforms.x.enabled,
    xLiveGoArmed: source.distribution.platforms.x.liveGoArmed,
    xAuthority: source.distribution.platforms.x.authority,
    instagramEnabled: source.distribution.platforms.instagram.enabled,
    instagramLiveGoArmed: source.distribution.platforms.instagram.liveGoArmed,
    instagramAuthority: source.distribution.platforms.instagram.authority,
    tiktokEnabled: source.distribution.platforms.tiktok.enabled,
    tiktokLiveGoArmed: source.distribution.platforms.tiktok.liveGoArmed,
    tiktokAuthority: source.distribution.platforms.tiktok.authority
  };
}

export function buildConfigUpdatePatch(draft: ConfigDraft): ConfigUpdatePatch {
  const dailyCreditLimit = parseWholeNumber(draft.dailyCreditLimit, "dailyCreditLimit");
  const monthlyCreditLimit = parseWholeNumber(draft.monthlyCreditLimit, "monthlyCreditLimit");
  const songsPerWeek = parseWholeNumber(draft.songsPerWeek, "songsPerWeek");
  const cycleIntervalMinutes = parseWholeNumber(draft.cycleIntervalMinutes, "cycleIntervalMinutes");

  if (dailyCreditLimit < 1 || dailyCreditLimit > 1000) {
    throw new Error("dailyCreditLimit must be between 1 and 1000");
  }

  if (monthlyCreditLimit < 0 || monthlyCreditLimit > 50000) {
    throw new Error("monthlyCreditLimit must be between 0 and 50000");
  }

  if (songsPerWeek < 0 || songsPerWeek > 21) {
    throw new Error("songsPerWeek must be between 0 and 21");
  }

  if (cycleIntervalMinutes < 15 || cycleIntervalMinutes > 1440) {
    throw new Error("cycleIntervalMinutes must be between 15 and 1440");
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
        driver: draft.sunoDriver,
        submitMode: draft.sunoSubmitMode
      }
    },
    autopilot: {
      enabled: draft.autopilotEnabled,
      dryRun: draft.dryRun,
      songsPerWeek,
      cycleIntervalMinutes
    },
    distribution: {
      liveGoArmed: draft.distributionLiveGoArmed,
      platforms: {
        x: { enabled: draft.xEnabled, liveGoArmed: draft.xLiveGoArmed, authority: draft.xAuthority },
        // Instagram is frozen by #4 boundary; arm flags are clamped to false even if the draft has them on.
        instagram: { enabled: draft.instagramEnabled, liveGoArmed: false, authority: draft.instagramAuthority },
        // TikTok stays frozen in the UI lane until the operator account exists.
        tiktok: { enabled: draft.tiktokEnabled, liveGoArmed: false, authority: draft.tiktokAuthority }
      }
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
