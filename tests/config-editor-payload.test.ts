import { describe, expect, it } from "vitest";
import { buildConfigDraft, buildConfigUpdatePatch, validateConfigDraft } from "../ui/src/configEditor";

describe("config editor payload builder", () => {
  it("builds a draft from config response shape", () => {
    expect(buildConfigDraft({
      ui: { locale: "ja" },
      music: {
        suno: {
          dailyCreditLimit: 60,
          monthlyCreditLimit: 0,
          driver: "mock",
          submitMode: "skip"
        }
      },
      autopilot: {
        enabled: true,
        dryRun: true,
        songsPerWeek: 5,
        cycleIntervalMinutes: 180
      },
      distribution: {
        liveGoArmed: false,
        platforms: {
          x: { enabled: true, liveGoArmed: true, authority: "auto_publish" },
          instagram: { enabled: false, liveGoArmed: false, authority: "draft_only" },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" }
        }
      }
    })).toEqual({
      uiLocale: "ja",
      dailyCreditLimit: "60",
      monthlyCreditLimit: "0",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "5",
      cycleIntervalMinutes: "180",
      distributionLiveGoArmed: false,
      xEnabled: true,
      xLiveGoArmed: true,
      xAuthority: "auto_publish",
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    });
  });

  it("builds the config/update patch payload", () => {
    expect(buildConfigUpdatePatch({
      uiLocale: "en",
      dailyCreditLimit: "120",
      monthlyCreditLimit: "240",
      sunoDriver: "playwright",
      sunoSubmitMode: "live",
      autopilotEnabled: true,
      dryRun: false,
      songsPerWeek: "7",
      cycleIntervalMinutes: "60",
      distributionLiveGoArmed: true,
      xEnabled: true,
      xLiveGoArmed: true,
      xAuthority: "auto_publish_and_low_risk_replies",
      instagramEnabled: true,
      instagramLiveGoArmed: true,
      instagramAuthority: "auto_publish_visuals",
      tiktokEnabled: false,
      tiktokLiveGoArmed: true,
      tiktokAuthority: "draft_only"
    })).toEqual({
      ui: {
        locale: "en"
      },
      music: {
        suno: {
          dailyCreditLimit: 120,
          monthlyCreditLimit: 240,
          driver: "playwright",
          submitMode: "live"
        }
      },
      autopilot: {
        enabled: true,
        dryRun: false,
        songsPerWeek: 7,
        cycleIntervalMinutes: 60
      },
      distribution: {
        liveGoArmed: true,
        platforms: {
          x: { enabled: true, liveGoArmed: true, authority: "auto_publish_and_low_risk_replies" },
          instagram: { enabled: true, liveGoArmed: false, authority: "auto_publish_visuals" },
          tiktok: { enabled: false, liveGoArmed: false, authority: "draft_only" }
        }
      }
    });
  });

  it("keeps the TikTok live-go arm frozen even when the draft flips it on", () => {
    expect(buildConfigUpdatePatch({
      uiLocale: "auto",
      dailyCreditLimit: "120",
      monthlyCreditLimit: "0",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
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
    }).distribution.platforms.tiktok.liveGoArmed).toBe(false);
  });

  it("keeps the Instagram live-go arm frozen even when the draft flips it on", () => {
    expect(buildConfigUpdatePatch({
      uiLocale: "auto",
      dailyCreditLimit: "120",
      monthlyCreditLimit: "0",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
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
    }).distribution.platforms.instagram.liveGoArmed).toBe(false);
  });

  it("rejects unsupported Suno driver values", () => {
    expect(validateConfigDraft({
      uiLocale: "auto",
      dailyCreditLimit: "60",
      monthlyCreditLimit: "0",
      sunoDriver: "selenium" as never,
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "5",
      cycleIntervalMinutes: "180",
      distributionLiveGoArmed: false,
      xEnabled: true,
      xLiveGoArmed: false,
      xAuthority: "draft_only",
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    })).toBe("sunoDriver must be one of the supported Suno driver modes");
  });

  it("rejects unsupported Suno submit mode values", () => {
    expect(validateConfigDraft({
      uiLocale: "auto",
      dailyCreditLimit: "60",
      monthlyCreditLimit: "0",
      sunoDriver: "mock",
      sunoSubmitMode: "burn" as never,
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "5",
      cycleIntervalMinutes: "180",
      distributionLiveGoArmed: false,
      xEnabled: true,
      xLiveGoArmed: false,
      xAuthority: "draft_only",
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    })).toBe("sunoSubmitMode must be one of the supported Suno submit modes");
  });

  it("rejects out-of-range numeric values", () => {
    expect(validateConfigDraft({
      uiLocale: "auto",
      dailyCreditLimit: "0",
      monthlyCreditLimit: "0",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "24",
      cycleIntervalMinutes: "10",
      distributionLiveGoArmed: false,
      xEnabled: true,
      xLiveGoArmed: false,
      xAuthority: "draft_only",
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    })).toBe("dailyCreditLimit must be between 1 and 1000");
  });

  it("rejects non-whole-number values", () => {
    expect(validateConfigDraft({
      uiLocale: "auto",
      dailyCreditLimit: "sixty",
      monthlyCreditLimit: "0",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "2.5",
      cycleIntervalMinutes: "180",
      distributionLiveGoArmed: false,
      xEnabled: true,
      xLiveGoArmed: false,
      xAuthority: "draft_only",
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    })).toBe("dailyCreditLimit must be a whole number");
  });

  it("rejects unsupported authority values", () => {
    expect(validateConfigDraft({
      uiLocale: "auto",
      dailyCreditLimit: "60",
      monthlyCreditLimit: "0",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "5",
      cycleIntervalMinutes: "180",
      distributionLiveGoArmed: false,
      xEnabled: true,
      xLiveGoArmed: false,
      xAuthority: "full_social_autonomy" as never,
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    })).toBe("xAuthority must be one of the supported X authority modes");
  });

  it("rejects Suno daily credit limits above the supported ceiling", () => {
    expect(validateConfigDraft({
      uiLocale: "auto",
      dailyCreditLimit: "1001",
      monthlyCreditLimit: "0",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "5",
      cycleIntervalMinutes: "180",
      distributionLiveGoArmed: false,
      xEnabled: true,
      xLiveGoArmed: false,
      xAuthority: "draft_only",
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    })).toBe("dailyCreditLimit must be between 1 and 1000");
  });

  it("rejects Suno monthly credit limits above the supported ceiling", () => {
    expect(validateConfigDraft({
      uiLocale: "auto",
      dailyCreditLimit: "60",
      monthlyCreditLimit: "50001",
      sunoDriver: "mock",
      sunoSubmitMode: "skip",
      autopilotEnabled: true,
      dryRun: true,
      songsPerWeek: "5",
      cycleIntervalMinutes: "180",
      distributionLiveGoArmed: false,
      xEnabled: true,
      xLiveGoArmed: false,
      xAuthority: "draft_only",
      instagramEnabled: false,
      instagramLiveGoArmed: false,
      instagramAuthority: "draft_only",
      tiktokEnabled: false,
      tiktokLiveGoArmed: false,
      tiktokAuthority: "draft_only"
    })).toBe("monthlyCreditLimit must be between 0 and 50000");
  });
});
