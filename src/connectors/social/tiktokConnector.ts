import type { ConnectionStatus, SocialCapability, SocialPublishRequest, SocialPublishResult } from "../../types.js";
import type { SocialConnector } from "./SocialConnector.js";

const tiktokCapabilities: SocialCapability = {
  textPost: false,
  imagePost: false,
  videoPost: "unknown",
  carouselPost: false,
  reelPost: false,
  reply: false,
  quote: false,
  dm: false,
  scheduledPost: false,
  metrics: "unknown"
};

export class TikTokConnector implements SocialConnector {
  id = "tiktok" as const;

  async checkConnection(): Promise<ConnectionStatus> {
    return {
      connected: false,
      reason: "account_not_created"
    };
  }

  async checkCapabilities(): Promise<SocialCapability> {
    return tiktokCapabilities;
  }

  async publish(input: SocialPublishRequest): Promise<SocialPublishResult> {
    if (input.mediaPaths?.length && !input.mediaPaths.every(Boolean)) {
      return {
        accepted: false,
        platform: "tiktok",
        dryRun: input.dryRun,
        reason: "tiktok_media_invalid"
      };
    }

    return {
      accepted: false,
      platform: "tiktok",
      dryRun: input.dryRun,
      reason: input.dryRun ? "dry-run blocks publish" : "tiktok_publish_not_implemented"
    };
  }

  async reply(input: SocialPublishRequest): Promise<SocialPublishResult> {
    return {
      accepted: false,
      platform: "tiktok",
      dryRun: input.dryRun,
      reason: input.dryRun ? "dry-run blocks reply" : "tiktok_reply_not_supported"
    };
  }
}
