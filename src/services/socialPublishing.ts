import { createHash } from "node:crypto";
import { join } from "node:path";
import { applyConfigDefaults } from "../config/schema.js";
import { InstagramConnector } from "../connectors/social/instagramConnector.js";
import type { SocialConnector } from "../connectors/social/SocialConnector.js";
import { TikTokConnector } from "../connectors/social/tiktokConnector.js";
import { XBirdConnector } from "../connectors/social/xBirdConnector.js";
import type { ArtistRuntimeConfig, AuthorityDecision, SocialCapability, SocialPlatform, SocialPublishLedgerEntry, SocialPublishResult, SocialRiskLevel } from "../types.js";
import { readSongState, updateSongState } from "./artistState.js";
import { appendAuditLog, createAuditEvent } from "./auditLog.js";
import { decideSocialAuthority } from "./socialAuthority.js";
import { listSongStates } from "./artistState.js";
import { appendSocialPublishLedgerEntry, appendSocialReplyLedgerEntry, readLatestSocialPublishLedgerEntry, readSocialPublishLedgerEntries } from "./socialPublishLedger.js";
import { resolvePlatformSocialDryRun } from "./socialDryRunResolver.js";

export interface SocialActionInput {
  workspaceRoot: string;
  songId: string;
  platform: SocialPlatform;
  postType: string;
  text?: string;
  mediaPaths?: string[];
  risk?: SocialRiskLevel;
  config?: Partial<ArtistRuntimeConfig>;
  action?: "publish" | "reply";
  targetId?: string;
  targetUrl?: string;
  actor?: string;
}

function getConnector(platform: SocialPlatform): SocialConnector {
  switch (platform) {
    case "instagram":
      return new InstagramConnector();
    case "tiktok":
      return new TikTokConnector();
    case "x":
    default:
      return new XBirdConnector();
  }
}

function getPlatformAuthority(config: ArtistRuntimeConfig, platform: SocialPlatform) {
  return config.distribution.platforms[platform].authority;
}

function getAuditPath(root: string, songId: string): string {
  return join(root, "songs", songId, "audit", "actions.jsonl");
}

function hashText(value?: string): string | undefined {
  return value ? createHash("sha256").update(value).digest("hex") : undefined;
}

function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function platformAutoPostTypes(config: ArtistRuntimeConfig, platform: SocialPlatform): string[] {
  return config.distribution.platforms[platform].autoPostTypes;
}

function platformPostLimit(config: ArtistRuntimeConfig, platform: SocialPlatform): number {
  return config.distribution.platforms[platform].maxPostsPerDay;
}

function platformReplyLimit(config: ArtistRuntimeConfig, platform: SocialPlatform): number {
  return platform === "x" ? config.distribution.platforms.x.maxRepliesPerDay : 0;
}

function officialReleasePostType(postType: string): boolean {
  return /official|release/i.test(postType);
}

function containsForbiddenTopic(text: string | undefined, topics: string[]): string | undefined {
  const normalized = (text ?? "").toLowerCase();
  return topics.find((topic) => topic.trim() && normalized.includes(topic.trim().toLowerCase()));
}

async function readTodaysPlatformActions(root: string, platform: SocialPlatform, action: "publish" | "reply"): Promise<SocialPublishLedgerEntry[]> {
  const songs = await listSongStates(root);
  const today = todayKey();
  const entries = (
    await Promise.all(songs.map((song) => readSocialPublishLedgerEntries(root, song.songId).catch(() => [])))
  ).flat();
  return entries.filter((entry) =>
    entry.platform === platform
    && entry.action === action
    && entry.accepted
    && entry.timestamp.slice(0, 10) === today
  );
}

async function enforceSocialConfigPolicy(
  input: SocialActionInput,
  config: ArtistRuntimeConfig,
  baseDecision: AuthorityDecision
): Promise<AuthorityDecision> {
  if (!baseDecision.allowed) return baseDecision;
  const forbidden = containsForbiddenTopic(input.text, config.safety.forbiddenTopics);
  if (forbidden) {
    return {
      allowed: false,
      reason: `forbidden topic blocked: ${forbidden}`,
      requiresApproval: true,
      policyDecision: "deny_forbidden_topic"
    };
  }
  if (input.action !== "reply" && config.distribution.dailySharing === "off") {
    return { allowed: false, reason: "daily sharing is off", policyDecision: "deny_daily_sharing_off" };
  }
  if (input.action !== "reply" && config.distribution.dailySharing === "draft_only") {
    return { allowed: false, reason: "daily sharing is draft_only", policyDecision: "deny_daily_sharing_draft_only" };
  }
  if (input.action !== "reply" && officialReleasePostType(input.postType) && config.distribution.officialRelease === "manual_approval") {
    return { allowed: false, reason: "official release requires manual approval", requiresApproval: true, policyDecision: "require_official_release_approval" };
  }
  if (input.action !== "reply" && !platformAutoPostTypes(config, input.platform).includes(input.postType)) {
    return { allowed: false, reason: `${input.platform} post type is not enabled: ${input.postType}`, policyDecision: "deny_post_type" };
  }
  const action = input.action ?? "publish";
  if (action === "reply") {
    const limit = platformReplyLimit(config, input.platform);
    if (limit <= 0) {
      return { allowed: false, reason: `${input.platform} replies are capped at 0/day`, policyDecision: "deny_reply_cap" };
    }
    const replies = await readTodaysPlatformActions(input.workspaceRoot, input.platform, "reply");
    if (replies.length >= limit) {
      return { allowed: false, reason: `${input.platform} daily reply cap reached (${replies.length}/${limit})`, policyDecision: "deny_reply_cap" };
    }
  } else {
    const limit = platformPostLimit(config, input.platform);
    if (limit <= 0) {
      return { allowed: false, reason: `${input.platform} posts are capped at 0/day`, policyDecision: "deny_post_cap" };
    }
    const posts = await readTodaysPlatformActions(input.workspaceRoot, input.platform, "publish");
    if (posts.length >= limit) {
      return { allowed: false, reason: `${input.platform} daily post cap reached (${posts.length}/${limit})`, policyDecision: "deny_post_cap" };
    }
  }
  return baseDecision;
}

function capabilityForPostType(capability: SocialCapability, postType: string, action: "publish" | "reply") {
  if (action === "reply") {
    return capability.reply;
  }
  if (postType.includes("carousel")) {
    return capability.carouselPost;
  }
  if (postType.includes("reel")) {
    return capability.reelPost;
  }
  if (postType.includes("video") || postType.includes("clip") || postType.includes("teaser")) {
    return capability.videoPost;
  }
  if (postType.includes("image") || postType.includes("visual") || postType.includes("cover") || postType.includes("card")) {
    return capability.imagePost;
  }
  return capability.textPost;
}

export async function readLatestSocialAction(root: string, songId: string): Promise<SocialPublishLedgerEntry | undefined> {
  return readLatestSocialPublishLedgerEntry(root, songId);
}

export async function publishSocialAction(input: SocialActionInput): Promise<{ result: SocialPublishResult; entry: SocialPublishLedgerEntry }> {
  if (input.actor === "watchdog_recovery" || input.actor === "watchdog_reprompt" || input.actor === "watchdog_expire") {
    throw new Error("external_publish_actor_guard");
  }
  const action = input.action ?? "publish";
  const config = applyConfigDefaults(input.config);
  const effectiveDryRun = resolvePlatformSocialDryRun(config, input.platform);
  const connector = getConnector(input.platform);
  const capabilitySummary = await connector.checkCapabilities();
  const capabilityAvailable = capabilityForPostType(capabilitySummary, input.postType, action);
  let authorityDecision = decideSocialAuthority({
    dryRun: effectiveDryRun,
    authority: getPlatformAuthority(config, input.platform),
    platform: input.platform,
    risk: input.risk ?? "low",
    postType: input.postType,
    requestedAction: action,
    capabilityAvailable,
    requireApprovalForHighRisk: config.safety.requireApprovalForHighRisk
  });
  authorityDecision = await enforceSocialConfigPolicy(input, config, authorityDecision);
  if (action === "publish") {
    const songState = await readSongState(input.workspaceRoot, input.songId);
    if (songState.degradedLyrics) {
      authorityDecision.allowed = false;
      authorityDecision.reason = "degraded lyrics require producer review";
      authorityDecision.policyDecision = "deny_policy";
    }
  }
  const collectDryRunReplyAudit = action === "reply" && input.platform === "x" && effectiveDryRun;

  let result: SocialPublishResult = authorityDecision.allowed || collectDryRunReplyAudit
    ? action === "reply"
      ? await (connector.reply?.({
          dryRun: effectiveDryRun,
          authority: getPlatformAuthority(config, input.platform),
          postType: input.postType,
          text: input.text,
          mediaPaths: input.mediaPaths,
          targetId: input.targetId,
          targetUrl: input.targetUrl,
          globalLiveGoArmed: config.distribution.liveGoArmed,
          platformLiveGoArmed: config.distribution.platforms[input.platform].liveGoArmed,
          liveRehearsalArmed: input.platform === "instagram" ? config.distribution.platforms.instagram.liveRehearsalArmed : undefined
        }) ?? Promise.resolve({
          accepted: false,
          platform: input.platform,
          dryRun: effectiveDryRun,
          reason: `${input.platform} reply is unavailable`,
          url: undefined
        }))
      : await connector.publish({
          dryRun: effectiveDryRun,
          authority: getPlatformAuthority(config, input.platform),
          postType: input.postType,
          text: input.text,
          mediaPaths: input.mediaPaths,
          globalLiveGoArmed: config.distribution.liveGoArmed,
          platformLiveGoArmed: config.distribution.platforms[input.platform].liveGoArmed,
          liveRehearsalArmed: input.platform === "instagram" ? config.distribution.platforms.instagram.liveRehearsalArmed : undefined
        })
    : {
        accepted: false,
        platform: input.platform,
        dryRun: effectiveDryRun,
        reason: authorityDecision.reason,
        url: undefined
      };
  if (collectDryRunReplyAudit) {
    result = {
      ...result,
      reason: authorityDecision.reason
    };
  }

  const entry: SocialPublishLedgerEntry = {
    timestamp: new Date().toISOString(),
    platform: input.platform,
    connector: connector.id,
    songId: input.songId,
    postType: input.postType,
    action,
    accepted: result.accepted,
    dryRun: effectiveDryRun,
    textHash: hashText(input.text),
    mediaRefs: input.mediaPaths ?? [],
    policyDecision: authorityDecision,
    url: result.url,
    verification: {
      status: result.accepted ? "verified" : "pending",
      detail: result.reason
    },
    error: result.accepted ? undefined : { name: "SocialPublishResult", message: result.reason },
    reason: result.reason
  };
  if (action === "reply" && input.platform === "x" && result.raw && typeof result.raw === "object") {
    const raw = result.raw as Record<string, unknown>;
    const mentionedHandles = Array.isArray(raw.mentionedHandles)
      ? raw.mentionedHandles.filter((value): value is string => typeof value === "string")
      : undefined;
    entry.replyTarget = {
      type: "reply",
      targetId: typeof raw.targetId === "string" ? raw.targetId : undefined,
      resolvedFrom: typeof raw.resolvedFrom === "string" ? raw.resolvedFrom : undefined,
      resolutionReason: typeof raw.resolutionReason === "string" ? raw.resolutionReason : undefined,
      dryRun: raw.dryRun === true,
      timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
      mentionedHandles: mentionedHandles && mentionedHandles.length > 0 ? mentionedHandles : undefined,
      tweetId: typeof raw.tweetId === "string" ? raw.tweetId : undefined
    };
  }

  if (config.safety.auditLog) {
    await appendAuditLog(
      getAuditPath(input.workspaceRoot, input.songId),
      createAuditEvent({
        eventType: action === "reply" ? "social_reply" : "social_publish",
        actor: "connector",
        sourceRefs: input.mediaPaths,
        policyDecision: authorityDecision,
        verification: entry.verification,
        error: entry.error,
        details: {
          platform: input.platform,
          connector: connector.id,
          postType: input.postType,
          url: result.url
        }
      })
    );
  }
  if (action === "reply" && entry.replyTarget?.type === "reply") {
    await appendSocialReplyLedgerEntry(input.workspaceRoot, input.songId, entry);
  } else {
    await appendSocialPublishLedgerEntry(input.workspaceRoot, input.songId, entry);
  }

  if (action === "publish") {
    await updateSongState(input.workspaceRoot, input.songId, {
      status: result.accepted ? "published" : "social_assets",
      reason: result.reason,
      appendPublicLinks: result.url ? [result.url] : []
    });
  }

  return { result, entry };
}
