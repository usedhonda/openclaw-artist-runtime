import {
  aiReviewProviders,
  dailySharingModes,
  officialReleaseModes,
  producerDigestModes,
  instagramAuthorityModes,
  sunoDriverModes,
  sunoSubmitModes,
  tiktokAuthorityModes,
  xAuthorityModes,
  type AiReviewProvider,
  type DailySharingMode,
  type InstagramAuthority,
  type OfficialReleaseMode,
  type ProducerDigestMode,
  type SunoDriverMode,
  type SunoSubmitMode,
  type TikTokAuthority,
  type UiLocaleMode,
  type XAuthority
} from "../../src/types";

export type ConfigEditorSource = {
  fieldMeta?: ConfigFieldMetaMap;
  diagnostics?: RuntimeDiagnostics;
  ui?: {
    locale?: UiLocaleMode;
  };
  dashboard?: {
    baseUrl?: string;
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
    enabled: boolean;
    liveGoArmed: boolean;
    dailySharing: DailySharingMode;
    officialRelease: OfficialReleaseMode;
    platforms: {
      x: { enabled: boolean; liveGoArmed: boolean; authority: XAuthority; maxPostsPerDay: number; maxRepliesPerDay: number };
      instagram: { enabled: boolean; liveGoArmed: boolean; authority: InstagramAuthority };
      tiktok: { enabled: boolean; liveGoArmed: boolean; authority: TikTokAuthority };
    };
  };
  telegram?: {
    enabled: boolean;
    pollIntervalMs: number;
    notifyStages: boolean;
    acceptFreeText: boolean;
  };
  artistPulse?: {
    enabled: boolean;
    minIntervalHours: number;
  };
  commission?: {
    enabled: boolean;
  };
  songSpawn?: {
    enabled: boolean;
    minIntervalHours: number;
  };
  aiReview?: {
    provider: AiReviewProvider;
  };
  safety?: {
    auditLog: boolean;
  };
};

export type ConfigFieldSource = "config" | "override" | "env";

export interface ConfigFieldMeta {
  source: ConfigFieldSource;
  editable: boolean;
  envVar?: string;
}

export type ConfigFieldMetaMap = Record<string, ConfigFieldMeta>;

export type RuntimeDiagnosticSource = "env" | "default";

export interface RuntimeDiagnosticFlag {
  envVar: string;
  source: RuntimeDiagnosticSource;
  editable: false;
  enabled: boolean;
}

export interface RuntimeDiagnosticConfigured {
  envVar: string;
  source: RuntimeDiagnosticSource;
  editable: false;
  configured: boolean;
}

export interface RuntimeDiagnosticCount {
  envVar: string;
  source: RuntimeDiagnosticSource;
  editable: false;
  configured: boolean;
  count: number;
}

export interface RuntimeDiagnostics {
  newsX: {
    rssUrls: RuntimeDiagnosticCount;
    browserResolve: RuntimeDiagnosticFlag;
    articleResolve: RuntimeDiagnosticFlag;
    firefoxProfile: RuntimeDiagnosticConfigured;
    tcoFetch: RuntimeDiagnosticFlag;
  };
  telegram: {
    active: boolean;
    reason: "ready" | "disabled_by_flag" | "missing_token" | "missing_owner_user_ids";
    botToken: RuntimeDiagnosticConfigured;
    ownerUserIds: RuntimeDiagnosticCount;
    notifier: RuntimeDiagnosticFlag;
  };
}

export type ConfigDraft = {
  fieldMeta?: ConfigFieldMetaMap;
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
  distributionEnabled: boolean;
  distributionLiveGoArmed: boolean;
  dailySharing: DailySharingMode;
  officialRelease: OfficialReleaseMode;
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
  telegramEnabled: boolean;
  telegramPollIntervalMs: string;
  telegramNotifyStages: boolean;
  telegramAcceptFreeText: boolean;
  artistPulseEnabled: boolean;
  artistPulseMinIntervalHours: string;
  commissionEnabled: boolean;
  songSpawnEnabled: boolean;
  songSpawnMinIntervalHours: string;
  aiReviewProvider: AiReviewProvider;
  auditLog: boolean;
  uiLocale: UiLocaleMode;
  dashboardBaseUrl: string;
};

export type ConfigUpdatePatch = {
  ui?: {
    locale?: UiLocaleMode;
  };
  dashboard?: {
    baseUrl?: string;
  };
  music?: {
    suno?: {
      dailyCreditLimit?: number;
      monthlyCreditLimit?: number;
      monthlyGenerationBudget?: number;
      maxGenerationsPerDay?: number;
      minMinutesBetweenCreates?: number;
      driver?: SunoDriverMode;
      submitMode?: SunoSubmitMode;
    };
  };
  autopilot?: {
    enabled?: boolean;
    dryRun?: boolean;
    songsPerWeek?: number;
    cycleIntervalMinutes?: number;
    planningTimeoutDays?: number;
    producerDigest?: ProducerDigestMode;
  };
  distribution?: {
    enabled?: boolean;
    liveGoArmed?: boolean;
    dailySharing?: DailySharingMode;
    officialRelease?: OfficialReleaseMode;
    platforms: {
      x: { enabled?: boolean; liveGoArmed?: boolean; authority?: XAuthority; maxPostsPerDay?: number; maxRepliesPerDay?: number };
      instagram: { enabled?: boolean; liveGoArmed?: boolean; authority?: InstagramAuthority };
      tiktok: { enabled?: boolean; liveGoArmed?: boolean; authority?: TikTokAuthority };
    };
  };
  telegram?: {
    enabled?: boolean;
    pollIntervalMs?: number;
    notifyStages?: boolean;
    acceptFreeText?: boolean;
  };
  artistPulse?: {
    enabled?: boolean;
    minIntervalHours?: number;
  };
  commission?: {
    enabled?: boolean;
  };
  songSpawn?: {
    enabled?: boolean;
    minIntervalHours?: number;
  };
  aiReview?: {
    provider?: AiReviewProvider;
  };
  safety?: {
    auditLog?: boolean;
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
    ...(source.fieldMeta ? { fieldMeta: source.fieldMeta } : {}),
    uiLocale: source.ui?.locale ?? "auto",
    dashboardBaseUrl: source.dashboard?.baseUrl ?? "",
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
    distributionEnabled: source.distribution.enabled,
    distributionLiveGoArmed: source.distribution.liveGoArmed,
    dailySharing: source.distribution.dailySharing ?? "auto",
    officialRelease: source.distribution.officialRelease ?? "manual_approval",
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
    telegramEnabled: source.telegram?.enabled ?? false,
    telegramPollIntervalMs: String(source.telegram?.pollIntervalMs ?? 2000),
    telegramNotifyStages: source.telegram?.notifyStages ?? true,
    telegramAcceptFreeText: source.telegram?.acceptFreeText ?? true,
    artistPulseEnabled: source.artistPulse?.enabled ?? false,
    artistPulseMinIntervalHours: String(source.artistPulse?.minIntervalHours ?? 12),
    commissionEnabled: source.commission?.enabled ?? false,
    songSpawnEnabled: source.songSpawn?.enabled ?? false,
    songSpawnMinIntervalHours: String(source.songSpawn?.minIntervalHours ?? 24),
    aiReviewProvider: source.aiReview?.provider ?? "mock",
    auditLog: source.safety?.auditLog ?? true
  };
}

function fieldEditable(draft: ConfigDraft, path: string): boolean {
  return draft.fieldMeta?.[path]?.editable !== false;
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
  const telegramPollIntervalMs = parseWholeNumber(draft.telegramPollIntervalMs, "telegramPollIntervalMs");
  const artistPulseMinIntervalHours = parseWholeNumber(draft.artistPulseMinIntervalHours, "artistPulseMinIntervalHours");
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

  if (!dailySharingModes.includes(draft.dailySharing)) {
    throw new Error("dailySharing must be one of the supported daily sharing modes");
  }

  if (!officialReleaseModes.includes(draft.officialRelease)) {
    throw new Error("officialRelease must be one of the supported official release modes");
  }

  if (xMaxPostsPerDay < 0 || xMaxPostsPerDay > 50) {
    throw new Error("xMaxPostsPerDay must be between 0 and 50");
  }

  if (xMaxRepliesPerDay < 0 || xMaxRepliesPerDay > 200) {
    throw new Error("xMaxRepliesPerDay must be between 0 and 200");
  }

  if (telegramPollIntervalMs < 500 || telegramPollIntervalMs > 60000) {
    throw new Error("telegramPollIntervalMs must be between 500 and 60000");
  }

  if (artistPulseMinIntervalHours < 6 || artistPulseMinIntervalHours > 168) {
    throw new Error("artistPulseMinIntervalHours must be between 6 and 168");
  }

  if (songSpawnMinIntervalHours < 12 || songSpawnMinIntervalHours > 168) {
    throw new Error("songSpawnMinIntervalHours must be between 12 and 168");
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

  if (!aiReviewProviders.includes(draft.aiReviewProvider)) {
    throw new Error("aiReviewProvider must be one of the supported AI helper providers");
  }

  if (!["auto", "ja", "en"].includes(draft.uiLocale)) {
    throw new Error("uiLocale must be one of auto, ja, en");
  }

  return {
    ui: {
      locale: draft.uiLocale
    },
    dashboard: {
      baseUrl: draft.dashboardBaseUrl.trim()
    },
    music: {
      suno: {
        dailyCreditLimit,
        monthlyCreditLimit,
        monthlyGenerationBudget,
        maxGenerationsPerDay,
        minMinutesBetweenCreates,
        ...(fieldEditable(draft, "music.suno.driver") ? { driver: draft.sunoDriver } : {}),
        ...(fieldEditable(draft, "music.suno.submitMode") ? { submitMode: draft.sunoSubmitMode } : {})
      }
    },
    autopilot: {
      enabled: draft.autopilotEnabled,
      ...(fieldEditable(draft, "autopilot.dryRun") ? { dryRun: draft.dryRun } : {}),
      songsPerWeek,
      cycleIntervalMinutes,
      planningTimeoutDays,
      producerDigest: draft.producerDigest
    },
    distribution: {
      enabled: draft.distributionEnabled,
      liveGoArmed: draft.distributionLiveGoArmed,
      dailySharing: draft.dailySharing,
      officialRelease: draft.officialRelease,
      platforms: {
        x: { enabled: draft.xEnabled, liveGoArmed: draft.xLiveGoArmed, authority: draft.xAuthority, maxPostsPerDay: xMaxPostsPerDay, maxRepliesPerDay: xMaxRepliesPerDay },
        // Instagram is frozen by #4 boundary; arm flags are clamped to false even if the draft has them on.
        instagram: { enabled: draft.instagramEnabled, liveGoArmed: false, authority: draft.instagramAuthority },
        // TikTok stays frozen in the UI lane until the operator account exists.
        tiktok: { enabled: draft.tiktokEnabled, liveGoArmed: false, authority: draft.tiktokAuthority }
      }
    },
    telegram: {
      enabled: draft.telegramEnabled,
      pollIntervalMs: telegramPollIntervalMs,
      notifyStages: draft.telegramNotifyStages,
      acceptFreeText: draft.telegramAcceptFreeText
    },
    artistPulse: {
      enabled: draft.artistPulseEnabled,
      minIntervalHours: artistPulseMinIntervalHours
    },
    commission: {
      enabled: draft.commissionEnabled
    },
    songSpawn: {
      enabled: draft.songSpawnEnabled,
      minIntervalHours: songSpawnMinIntervalHours
    },
    aiReview: {
      ...(fieldEditable(draft, "aiReview.provider") ? { provider: draft.aiReviewProvider } : {})
    },
    safety: {
      auditLog: draft.auditLog
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
