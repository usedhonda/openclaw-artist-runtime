import type { ArtistRuntimeConfig } from "../types.js";

export const defaultArtistRuntimeConfig: ArtistRuntimeConfig = {
  schemaVersion: 1,
  artist: {
    mode: "public_artist",
    artistId: "artist",
    profilePath: "ARTIST.md",
    workspaceRoot: ".local/openclaw/workspace",
    identity: {}
  },
  autopilot: {
    enabled: true,
    dryRun: true,
    songsPerWeek: 3,
    cycleIntervalMinutes: 180,
    planningTimeoutDays: 7,
    producerDigest: "daily"
  },
  dashboard: {
    baseUrl: ""
  },
  music: {
    engine: "suno",
    suno: {
      enabled: true,
      connectionMode: "background_browser_worker",
      driver: "mock",
      submitMode: "skip",
      authority: "auto_create_and_select_take",
      dailyCreditLimit: 60,
      monthlyCreditLimit: 0,
      monthlyGenerationBudget: 50,
      maxGenerationsPerDay: 4,
      minMinutesBetweenCreates: 20,
      stopOnLoginChallenge: true,
      stopOnCaptcha: true,
      stopOnPaymentPrompt: true,
      promptLogging: "full"
    }
  },
  distribution: {
    enabled: false,
    liveGoArmed: false,
    dailySharing: "auto",
    officialRelease: "manual_approval",
    platforms: {
      x: {
        enabled: false,
        liveGoArmed: false,
        authStatus: "unconfigured",
        connector: "bird",
        authority: "auto_publish",
        maxPostsPerDay: 3,
        maxRepliesPerDay: 0,
        autoPostTypes: ["observation", "studio_note", "lyric_fragment", "demo_teaser", "new_song_link"]
      },
      instagram: {
        enabled: false,
        liveGoArmed: false,
        authStatus: "unconfigured",
        liveRehearsalArmed: false,
        connector: "instagram_content_publishing",
        authority: "auto_publish_visuals",
        maxPostsPerDay: 1,
        autoPostTypes: ["lyric_card", "reel_teaser", "cover_visual"]
      },
      tiktok: {
        enabled: false,
        liveGoArmed: false,
        authStatus: "unconfigured",
        connector: "tiktok_content_posting",
        authority: "auto_publish_clips",
        maxPostsPerDay: 1,
        autoPostTypes: ["hook_clip", "demo_teaser"]
      }
    }
  },
  telegram: {
    enabled: false,
    pollIntervalMs: 2000,
    notifyStages: true,
    acceptFreeText: true
  },
  artistPulse: {
    enabled: false,
    minIntervalHours: 12
  },
  commission: {
    enabled: false
  },
  songSpawn: {
    enabled: false,
    minIntervalHours: 24
  },
  observation: {
    newsRssUrls: []
  },
  aiReview: {
    provider: "mock"
  },
  ui: {
    locale: "auto"
  },
  safety: {
    auditLog: true,
    failClosed: true,
    forbiddenTopics: ["politics", "medical", "financial", "religion", "private_individuals", "legal_claims"],
    forbidCaptchaBypass: true,
    forbidCredentialLogging: true,
    requireApprovalForHighRisk: true
  }
};
