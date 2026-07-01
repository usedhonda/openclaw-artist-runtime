import { describe, expect, it } from "vitest";
import { buildConfigDraft, buildConfigUpdatePatch, validateConfigDraft, type ConfigDraft } from "../ui/src/configEditor";

const baseDraft = (overrides: Partial<ConfigDraft> = {}): ConfigDraft => ({
  uiLocale: "auto",
  dashboardBaseUrl: "",
  dailyCreditLimit: "60",
  monthlyCreditLimit: "0",
  monthlyGenerationBudget: "50",
  maxGenerationsPerDay: "4",
  minMinutesBetweenCreates: "20",
  sunoDriver: "mock",
  sunoSubmitMode: "skip",
  autopilotEnabled: true,
  dryRun: true,
  songsPerWeek: "5",
  cycleIntervalMinutes: "180",
  planningTimeoutDays: "7",
  producerDigest: "daily",
  distributionEnabled: true,
  distributionLiveGoArmed: false,
  dailySharing: "auto",
  officialRelease: "manual_approval",
  xEnabled: true,
  xLiveGoArmed: false,
  xAuthority: "draft_only",
  xMaxPostsPerDay: "3",
  xMaxRepliesPerDay: "0",
  instagramEnabled: false,
  instagramLiveGoArmed: false,
  instagramAuthority: "draft_only",
  tiktokEnabled: false,
  tiktokLiveGoArmed: false,
  tiktokAuthority: "draft_only",
  telegramEnabled: true,
  telegramPollIntervalMs: "2000",
  telegramNotifyStages: true,
  telegramAcceptFreeText: true,
  artistPulseEnabled: false,
  artistPulseMinIntervalHours: "12",
  commissionEnabled: false,
  songSpawnEnabled: true,
  songSpawnMinIntervalHours: "13",
  aiReviewProvider: "mock",
  auditLog: true,
  ...overrides
});

describe("config editor payload builder", () => {
  it("builds a draft from config response shape", () => {
    expect(buildConfigDraft({
      ui: { locale: "ja" },
      dashboard: {
        baseUrl: "https://tailnet.example.test"
      },
      music: {
        suno: {
          dailyCreditLimit: 60,
          monthlyCreditLimit: 0,
          monthlyGenerationBudget: 50,
          maxGenerationsPerDay: 4,
          minMinutesBetweenCreates: 20,
          driver: "mock",
          submitMode: "skip"
        }
      },
      autopilot: {
        enabled: true,
        dryRun: true,
        songsPerWeek: 5,
        cycleIntervalMinutes: 180,
        planningTimeoutDays: 7,
        producerDigest: "daily"
      },
      distribution: {
        enabled: true,
        liveGoArmed: false,
        dailySharing: "auto",
        officialRelease: "manual_approval",
        platforms: {
          x: { enabled: true, liveGoArmed: true, authority: "auto_publish", maxPostsPerDay: 3, maxRepliesPerDay: 1 },
          instagram: { enabled: false, liveGoArmed: false, authority: "draft_only" },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" }
        }
      },
      telegram: {
        enabled: true,
        pollIntervalMs: 2000,
        notifyStages: true,
        acceptFreeText: true
      },
      artistPulse: {
        enabled: true,
        minIntervalHours: 18
      },
      commission: {
        enabled: true
      },
      songSpawn: {
        enabled: true,
        minIntervalHours: 13
      },
      aiReview: {
        provider: "openclaw"
      },
      safety: {
        auditLog: true
      }
    })).toEqual({
      uiLocale: "ja",
      dashboardBaseUrl: "https://tailnet.example.test",
      dailyCreditLimit: "60",
      monthlyCreditLimit: "0",
      monthlyGenerationBudget: "50",
      maxGenerationsPerDay: "4",
      minMinutesBetweenCreates: "20",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "5",
      cycleIntervalMinutes: "180",
      planningTimeoutDays: "7",
      producerDigest: "daily",
      distributionEnabled: true,
      distributionLiveGoArmed: false,
      dailySharing: "auto",
      officialRelease: "manual_approval",
      xEnabled: true,
      xLiveGoArmed: true,
      xAuthority: "auto_publish",
      xMaxPostsPerDay: "3",
      xMaxRepliesPerDay: "1",
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only",
      telegramEnabled: true,
      telegramPollIntervalMs: "2000",
      telegramNotifyStages: true,
      telegramAcceptFreeText: true,
      artistPulseEnabled: true,
      artistPulseMinIntervalHours: "18",
      commissionEnabled: true,
      songSpawnEnabled: true,
      songSpawnMinIntervalHours: "13",
      aiReviewProvider: "openclaw",
      auditLog: true
    });
  });

  it("builds the config/update patch payload", () => {
    expect(buildConfigUpdatePatch(baseDraft({
      uiLocale: "en",
      dashboardBaseUrl: "https://tailnet.example.test/plugins/artist-runtime",
      dailyCreditLimit: "120",
      monthlyCreditLimit: "240",
      monthlyGenerationBudget: "88",
      maxGenerationsPerDay: "12",
      minMinutesBetweenCreates: "8",
      sunoDriver: "playwright",
      sunoSubmitMode: "live",
      autopilotEnabled: true,
      dryRun: false,
      songsPerWeek: "7",
      cycleIntervalMinutes: "60",
      planningTimeoutDays: "12",
      producerDigest: "important_events",
      distributionEnabled: true,
      distributionLiveGoArmed: true,
      dailySharing: "draft_only",
      officialRelease: "auto_with_release_policy",
      xEnabled: true,
      xLiveGoArmed: true,
      xAuthority: "auto_publish_and_low_risk_replies",
      xMaxPostsPerDay: "9",
      xMaxRepliesPerDay: "2",
      instagramEnabled: true,
      instagramLiveGoArmed: true,
      instagramAuthority: "auto_publish_visuals",
      tiktokEnabled: false,
      tiktokLiveGoArmed: true,
      tiktokAuthority: "draft_only",
      telegramEnabled: true,
      telegramPollIntervalMs: "5000",
      telegramNotifyStages: false,
      telegramAcceptFreeText: false,
      artistPulseEnabled: true,
      artistPulseMinIntervalHours: "18",
      commissionEnabled: true,
      songSpawnEnabled: false,
      songSpawnMinIntervalHours: "24",
      aiReviewProvider: "openclaw",
      auditLog: false
    }))).toEqual({
      ui: {
        locale: "en"
      },
      dashboard: {
        baseUrl: "https://tailnet.example.test/plugins/artist-runtime"
      },
      music: {
        suno: {
          dailyCreditLimit: 120,
          monthlyCreditLimit: 240,
          monthlyGenerationBudget: 88,
          maxGenerationsPerDay: 12,
          minMinutesBetweenCreates: 8,
          driver: "playwright",
          submitMode: "live"
        }
      },
      autopilot: {
        enabled: true,
        dryRun: false,
        songsPerWeek: 7,
        cycleIntervalMinutes: 60,
        planningTimeoutDays: 12,
        producerDigest: "important_events"
      },
      distribution: {
        enabled: true,
        liveGoArmed: true,
        dailySharing: "draft_only",
        officialRelease: "auto_with_release_policy",
        platforms: {
          x: { enabled: true, liveGoArmed: true, authority: "auto_publish_and_low_risk_replies", maxPostsPerDay: 9, maxRepliesPerDay: 2 },
          instagram: { enabled: true, liveGoArmed: false, authority: "auto_publish_visuals" },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" }
        }
      },
      telegram: {
        enabled: true,
        pollIntervalMs: 5000,
        notifyStages: false,
        acceptFreeText: false
      },
      artistPulse: {
        enabled: true,
        minIntervalHours: 18
      },
      commission: {
        enabled: true
      },
      songSpawn: {
        enabled: false,
        minIntervalHours: 24
      },
      aiReview: {
        provider: "openclaw"
      },
      safety: {
        auditLog: false
      }
    });
  });

  it("keeps the TikTok live-go arm frozen even when the draft flips it on", () => {
    expect(buildConfigUpdatePatch(baseDraft({
      dailyCreditLimit: "120",
      dryRun: false,
      songsPerWeek: "7",
      cycleIntervalMinutes: "60",
      distributionLiveGoArmed: true,
      xEnabled: true,
      xLiveGoArmed: true,
      xAuthority: "auto_publish",
      instagramEnabled: true,
      instagramLiveGoArmed: true,
      instagramAuthority: "auto_publish_visuals",
      tiktokEnabled: true,
      tiktokLiveGoArmed: true,
      tiktokAuthority: "auto_publish_clips"
    })).distribution.platforms.tiktok.liveGoArmed).toBe(false);
  });

  it("keeps the Instagram live-go arm frozen even when the draft flips it on", () => {
    expect(buildConfigUpdatePatch(baseDraft({
      dailyCreditLimit: "120",
      dryRun: false,
      songsPerWeek: "7",
      cycleIntervalMinutes: "60",
      distributionLiveGoArmed: true,
      xEnabled: true,
      xLiveGoArmed: true,
      xAuthority: "auto_publish",
      instagramEnabled: true,
      instagramLiveGoArmed: true,
      instagramAuthority: "auto_publish_visuals",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    })).distribution.platforms.instagram.liveGoArmed).toBe(false);
  });

  it("rejects unsupported Suno driver values", () => {
    expect(validateConfigDraft(baseDraft({
      sunoDriver: "selenium" as never
    }))).toBe("sunoDriver must be one of the supported Suno driver modes");
  });

  it("rejects unsupported Suno submit mode values", () => {
    expect(validateConfigDraft(baseDraft({
      sunoSubmitMode: "burn" as never
    }))).toBe("sunoSubmitMode must be one of the supported Suno submit modes");
  });

  it("rejects out-of-range numeric values", () => {
    expect(validateConfigDraft(baseDraft({
      dailyCreditLimit: "0",
      songsPerWeek: "101",
      cycleIntervalMinutes: "10"
    }))).toBe("dailyCreditLimit must be between 1 and 1000");
  });

  it("rejects non-whole-number values", () => {
    expect(validateConfigDraft(baseDraft({
      dailyCreditLimit: "sixty",
      songsPerWeek: "2.5"
    }))).toBe("dailyCreditLimit must be a whole number");
  });

  it("rejects unsupported authority values", () => {
    expect(validateConfigDraft(baseDraft({
      xAuthority: "full_social_autonomy" as never
    }))).toBe("xAuthority must be one of the supported X authority modes");
  });

  it("rejects Suno daily credit limits above the supported ceiling", () => {
    expect(validateConfigDraft(baseDraft({
      dailyCreditLimit: "1001"
    }))).toBe("dailyCreditLimit must be between 1 and 1000");
  });

  it("rejects Suno monthly credit limits above the supported ceiling", () => {
    expect(validateConfigDraft(baseDraft({
      monthlyCreditLimit: "50001"
    }))).toBe("monthlyCreditLimit must be between 0 and 50000");
  });
});
