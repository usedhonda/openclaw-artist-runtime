import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { ConnectionStatus, SocialCapability, SocialPublishRequest, SocialPublishResult } from "../../types.js";
import { birdComposeDryRun, birdWhoami, combinedBirdOutput, runBirdCommand, type SpawnImpl } from "../../services/birdRunner.js";
import type { SocialConnector } from "./SocialConnector.js";
import { resolveReplyTarget, type ReplyTargetFetch } from "./resolveReplyTarget.js";
import { extractMentionedHandles, extractTweetIdFromUrl } from "./xMediaMetadata.js";

const xCapabilities: SocialCapability = {
  textPost: true,
  imagePost: "unknown",
  videoPost: "unknown",
  carouselPost: false,
  reelPost: false,
  reply: true,
  quote: "unknown",
  dm: false,
  scheduledPost: false,
  metrics: "unknown"
};

interface PublishRecord {
  textHash: string;
  publishedAtMs: number;
}

interface PublishGuardState {
  recentPublishes: PublishRecord[];
}

interface XBirdConnectorOptions {
  now?: () => number;
  publishGuardState?: PublishGuardState;
  minPublishIntervalMs?: number;
  dedupeHistoryLimit?: number;
  dryRunStageExecution?: boolean;
  replyTargetFetchImpl?: ReplyTargetFetch;
}

const DEFAULT_PUBLISH_GUARD_STATE: PublishGuardState = {
  recentPublishes: []
};

const BIRD_PROBE_TIMEOUT_MS = 3000;
const BIRD_PUBLISH_TIMEOUT_MS = 3000;
const DEFAULT_MIN_PUBLISH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DEDUPE_HISTORY_LIMIT = 10;
const DRY_RUN_BLOCK_REASON = "dry-run blocks publish";
const DRY_RUN_REPLY_BLOCK_REASON = "dry-run blocks reply";
const LIVE_GO_BLOCK_REASON = "requires_explicit_live_go";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Reserved for the guarded live publish path; current runtime remains fail-closed.
function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Reserved for future publish guard telemetry without changing current dry-run behavior.
function resolveRecentPublishes(state: PublishGuardState, limit: number): PublishRecord[] {
  return state.recentPublishes.slice(-limit);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Reserved for guarded live publish enforcement; not invoked while live publish stays blocked.
function checkPublishGuards(
  recentPublishes: PublishRecord[],
  textDigest: string,
  nowMs: number,
  minPublishIntervalMs: number
): SocialPublishResult | undefined {
  const duplicate = recentPublishes.some((entry) => entry.textHash === textDigest);
  if (duplicate) {
    return {
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "bird_duplicate_text_blocked"
    };
  }

  const latestPublish = recentPublishes.at(-1);
  if (latestPublish && nowMs - latestPublish.publishedAtMs < minPublishIntervalMs) {
    return {
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "bird_min_interval_blocked"
    };
  }

  return undefined;
}

export class XBirdConnector implements SocialConnector {
  private readonly now: () => number;
  private readonly publishGuardState: PublishGuardState;
  private readonly minPublishIntervalMs: number;
  private readonly dedupeHistoryLimit: number;
  private readonly dryRunStageExecution: boolean;
  private readonly replyTargetFetchImpl?: ReplyTargetFetch;

  constructor(private readonly spawnImpl: SpawnImpl = spawn, options: XBirdConnectorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.publishGuardState = options.publishGuardState ?? DEFAULT_PUBLISH_GUARD_STATE;
    this.minPublishIntervalMs = options.minPublishIntervalMs ?? DEFAULT_MIN_PUBLISH_INTERVAL_MS;
    this.dedupeHistoryLimit = options.dedupeHistoryLimit ?? DEFAULT_DEDUPE_HISTORY_LIMIT;
    this.dryRunStageExecution = options.dryRunStageExecution ?? false;
    this.replyTargetFetchImpl = options.replyTargetFetchImpl;
  }

  id = "x" as const;

  async checkConnection(): Promise<ConnectionStatus> {
    const cliProbe = await runBirdCommand(["--help"], {
      spawnImpl: this.spawnImpl,
      timeoutMs: BIRD_PROBE_TIMEOUT_MS,
      useFirefoxProfile: false
    });
    if (cliProbe.error === "bird_cli_not_installed") {
      return { connected: false, reason: "bird_cli_not_installed" };
    }

    const whoamiProbe = await birdWhoami({
      spawnImpl: this.spawnImpl,
      timeoutMs: BIRD_PROBE_TIMEOUT_MS
    });
    if (whoamiProbe.error === "bird_cli_not_installed") {
      return { connected: false, reason: "bird_cli_not_installed" };
    }

    if (whoamiProbe.authed) {
      return {
        connected: true,
        accountLabel: whoamiProbe.account
      };
    }

    if (whoamiProbe.error === "bird_auth_expired" || whoamiProbe.error === "bird_auth_missing") {
      return {
        connected: false,
        reason: "bird_auth_expired"
      };
    }

    return {
      connected: false,
      reason: "bird_probe_failed"
    };
  }

  async checkCapabilities(): Promise<SocialCapability> {
    return xCapabilities;
  }

  async publish(input: SocialPublishRequest): Promise<SocialPublishResult> {
    if (input.dryRun) {
      if (this.dryRunStageExecution) {
        return this.publishDryRunStages(input);
      }
      return {
        accepted: false,
        platform: "x",
        dryRun: true,
        reason: DRY_RUN_BLOCK_REASON
      };
    }

    return {
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: LIVE_GO_BLOCK_REASON
    };
  }

  async reply(input: SocialPublishRequest): Promise<SocialPublishResult> {
    if (input.dryRun) {
      const resolvedTarget = await resolveReplyTarget(input, { fetchImpl: this.replyTargetFetchImpl });
      const mentionedHandles = extractMentionedHandles(input.text ?? "");
      const tweetIdHint = extractTweetIdFromUrl(input.targetUrl);
      if (!resolvedTarget.ok) {
        return {
          accepted: false,
          platform: "x",
          dryRun: true,
          reason: DRY_RUN_REPLY_BLOCK_REASON,
          raw: {
            type: "reply",
            resolvedFrom: resolvedTarget.resolvedFrom,
            resolutionReason: resolvedTarget.reason,
            dryRun: true,
            timestamp: new Date(this.now()).toISOString(),
            mentionedHandles,
            tweetId: tweetIdHint
          }
        };
      }
      return {
        accepted: false,
        platform: "x",
        dryRun: true,
        reason: DRY_RUN_REPLY_BLOCK_REASON,
        raw: {
          type: "reply",
          targetId: resolvedTarget.targetId,
          resolvedFrom: resolvedTarget.resolvedFrom,
          dryRun: true,
          timestamp: new Date(this.now()).toISOString(),
          mentionedHandles,
          tweetId: resolvedTarget.targetId
        }
      };
    }

    return {
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: LIVE_GO_BLOCK_REASON
    };
  }

  private async publishDryRunStages(input: SocialPublishRequest): Promise<SocialPublishResult> {
    const text = input.text?.trim() ?? "";
    if (!text) {
      return {
        accepted: false,
        platform: "x",
        dryRun: true,
        reason: "bird_text_required"
      };
    }

    const authCheck = await birdWhoami({
      spawnImpl: this.spawnImpl,
      timeoutMs: BIRD_PROBE_TIMEOUT_MS
    });
    if (authCheck.error === "bird_cli_not_installed") {
      return {
        accepted: false,
        platform: "x",
        dryRun: true,
        reason: "bird_cli_not_installed"
      };
    }
    if (!authCheck.authed) {
      return {
        accepted: false,
        platform: "x",
        dryRun: true,
        reason: authCheck.error === "bird_auth_expired" || authCheck.error === "bird_auth_missing" ? "bird_auth_expired" : "bird_probe_failed"
      };
    }

    const compose = await birdComposeDryRun(text, {
      spawnImpl: this.spawnImpl,
      timeoutMs: BIRD_PUBLISH_TIMEOUT_MS
    });
    if (!compose.ok) {
      return {
        accepted: false,
        platform: "x",
        dryRun: true,
        reason: "bird_compose_failed"
      };
    }

    const submit = await runBirdCommand(["--plain", "tweet", "--dry-run", text], {
      spawnImpl: this.spawnImpl,
      timeoutMs: BIRD_PUBLISH_TIMEOUT_MS
    });
    if (submit.status !== "success") {
      return {
        accepted: false,
        platform: "x",
        dryRun: true,
        reason: submit.error === "bird_rate_limited" ? "bird_rate_limited" : "bird_dry_run_submit_failed"
      };
    }

    return {
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: DRY_RUN_BLOCK_REASON,
      raw: {
        accountLabel: authCheck.account,
        stageOrder: ["auth_check", "compose", "submit"],
        submitPreview: combinedBirdOutput(submit) || undefined
      }
    };
  }
}
