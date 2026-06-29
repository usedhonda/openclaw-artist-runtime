import { describe, expect, it } from "vitest";
import { buildConfigDraft, buildConfigUpdatePatch, validateConfigDraft, type ConfigDraft } from "../ui/src/configEditor";

const baseDraft = (overrides: Partial<ConfigDraft> = {}): ConfigDraft => ({
  uiLocale: "auto",
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
  distributionLiveGoArmed: false,
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
  songSpawnEnabled: true,
  songSpawnMinIntervalHours: "13",
  ...overrides
});

describe("config editor payload builder", () => {
  it("builds a draft from config response shape", () => {
    expect(buildConfigDraft({
      ui: { locale: "ja" },
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
        liveGoArmed: false,
        platforms: {
          x: { enabled: true, liveGoArmed: true, authority: "auto_publish", maxPostsPerDay: 3, maxRepliesPerDay: 1 },
          instagram: { enabled: false, liveGoArmed: false, authority: "draft_only" },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" }
        }
      },
      songSpawn: {
        enabled: true,
        minIntervalHours: 13
      }
    })).toEqual({
      uiLocale: "ja",
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
      distributionLiveGoArmed: false,
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
      songSpawnEnabled: true,
      songSpawnMinIntervalHours: "13"
    });
  });

  it("builds the config/update patch payload", () => {
    expect(buildConfigUpdatePatch(baseDraft({
      uiLocale: "en",
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
      distributionLiveGoArmed: true,
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
      songSpawnEnabled: false,
      songSpawnMinIntervalHours: "24"
    }))).toEqual({
      ui: {
        locale: "en"
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
        liveGoArmed: true,
        platforms: {
          x: { enabled: true, liveGoArmed: true, authority: "auto_publish_and_low_risk_replies", maxPostsPerDay: 9, maxRepliesPerDay: 2 },
          instagram: { enabled: true, liveGoArmed: false, authority: "auto_publish_visuals" },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" }
        }
      },
      songSpawn: {
        enabled: false,
        minIntervalHours: 24
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
