import type { ConnectionStatus, SocialCapability, SocialPublishRequest, SocialPublishResult } from "../../types.js";
import type { SocialConnector } from "./SocialConnector.js";

type FetchImpl = typeof fetch;

const instagramCapabilities: SocialCapability = {
  textPost: false,
  imagePost: "unknown",
  videoPost: "unknown",
  carouselPost: "unknown",
  reelPost: "unknown",
  reply: false,
  quote: false,
  dm: false,
  scheduledPost: false,
  metrics: "unknown"
};

const INSTAGRAM_AUTH_ENV_VARS = [
  "OPENCLAW_INSTAGRAM_AUTH",
  "OPENCLAW_INSTAGRAM_ACCESS_TOKEN"
] as const;

const GRAPH_API_BASE_URL = "https://graph.facebook.com";
const DRY_RUN_BLOCK_REASON = "dry-run blocks publish";
const LIVE_GO_BLOCK_REASON = "requires_explicit_live_go";

export function canProceedWithLiveRehearsal(input: SocialPublishRequest): boolean {
  return Boolean(
    input.liveRehearsalArmed
    && input.platformLiveGoArmed
    && input.globalLiveGoArmed
    && input.liveRehearsalExplicitGo
  );
}

function resolveInstagramAuth(): string | undefined {
  for (const name of INSTAGRAM_AUTH_ENV_VARS) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function buildJsonHeaders(): Record<string, string> {
  return {
    "content-type": "application/json"
  };
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

export class InstagramConnector implements SocialConnector {
  id = "instagram" as const;

  constructor(private readonly fetchImpl: FetchImpl = fetch) {}

  async checkConnection(): Promise<ConnectionStatus> {
    const auth = resolveInstagramAuth();
    if (!auth) {
      return { connected: false, reason: "instagram_auth_not_configured" };
    }

    return {
      connected: true,
      accountLabel: "configured_via_env"
    };
  }

  async checkCapabilities(): Promise<SocialCapability> {
    return instagramCapabilities;
  }

  async publish(input: SocialPublishRequest): Promise<SocialPublishResult> {
    const auth = resolveInstagramAuth();
    if (!auth) {
      return {
        accepted: false,
        platform: "instagram",
        dryRun: input.dryRun,
        reason: "instagram_auth_not_configured"
      };
    }

    if (input.mediaPaths?.length && !input.mediaPaths.every(Boolean)) {
      return {
        accepted: false,
        platform: "instagram",
        dryRun: input.dryRun,
        reason: "instagram_media_invalid"
      };
    }

    if (!input.dryRun && !canProceedWithLiveRehearsal(input)) {
      return {
        accepted: false,
        platform: "instagram",
        dryRun: false,
        reason: LIVE_GO_BLOCK_REASON
      };
    }

    const businessAccount = await this.resolveBusinessAccount(auth);
    if (!businessAccount.ok) {
      return {
        accepted: false,
        platform: "instagram",
        dryRun: true,
        reason: businessAccount.reason
      };
    }

    const mediaContainer = await this.createMediaContainer(auth, businessAccount.businessAccountId, input);
    if (!mediaContainer.ok) {
      return {
        accepted: false,
        platform: "instagram",
        dryRun: true,
        reason: mediaContainer.reason,
        raw: {
          businessAccountId: businessAccount.businessAccountId,
          pageId: businessAccount.pageId
        }
      };
    }

    if (!input.dryRun) {
      return {
        accepted: false,
        platform: "instagram",
        dryRun: false,
        reason: LIVE_GO_BLOCK_REASON,
        raw: {
          pageId: businessAccount.pageId,
          businessAccountId: businessAccount.businessAccountId,
          containerId: mediaContainer.containerId,
          stageOrder: ["accounts", "media", "publish_blocked"],
          liveRehearsal: true
        }
      };
    }

    const publishStage = await this.publishMediaContainer(auth, businessAccount.businessAccountId, mediaContainer.containerId);
    if (!publishStage.ok) {
      return {
        accepted: false,
        platform: "instagram",
        dryRun: true,
        reason: publishStage.reason,
        raw: {
          businessAccountId: businessAccount.businessAccountId,
          pageId: businessAccount.pageId,
          containerId: mediaContainer.containerId
        }
      };
    }

    return {
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: DRY_RUN_BLOCK_REASON,
      raw: {
        pageId: businessAccount.pageId,
        businessAccountId: businessAccount.businessAccountId,
        containerId: mediaContainer.containerId,
        publishedMediaId: publishStage.mediaId,
        stageOrder: ["accounts", "media", "publish"]
      }
    };
  }

  async reply(input: SocialPublishRequest): Promise<SocialPublishResult> {
    return {
      accepted: false,
      platform: "instagram",
      dryRun: input.dryRun,
      reason: input.dryRun ? "dry-run blocks reply" : "instagram_reply_not_supported"
    };
  }

  private async resolveBusinessAccount(auth: string): Promise<
    | { ok: true; pageId: string; businessAccountId: string }
    | { ok: false; reason: string }
  > {
    try {
      const response = await this.fetchImpl(`${GRAPH_API_BASE_URL}/me/accounts?access_token=${encodeURIComponent(auth)}`);
      if (!response.ok) {
        return { ok: false, reason: `instagram_graph_accounts_failed_${response.status}` };
      }
      const payload = await readJsonResponse(response);
      const account = Array.isArray(payload.data) ? payload.data[0] as Record<string, unknown> | undefined : undefined;
      const pageId = typeof account?.id === "string" ? account.id : undefined;
      const businessAccountId = this.readBusinessAccountId(account);
      if (!pageId || !businessAccountId) {
        return { ok: false, reason: "instagram_business_account_not_found" };
      }
      return { ok: true, pageId, businessAccountId };
    } catch (error) {
      return { ok: false, reason: `instagram_graph_accounts_failed:${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async createMediaContainer(
    auth: string,
    businessAccountId: string,
    input: SocialPublishRequest
  ): Promise<{ ok: true; containerId: string } | { ok: false; reason: string }> {
    try {
      const response = await this.fetchImpl(`${GRAPH_API_BASE_URL}/${businessAccountId}/media`, {
        method: "POST",
        headers: buildJsonHeaders(),
        body: JSON.stringify({
          access_token: auth,
          caption: input.text ?? "",
          image_url: input.mediaPaths?.[0] ?? "",
          media_type: "IMAGE"
        })
      });
      if (!response.ok) {
        return { ok: false, reason: `instagram_graph_media_failed_${response.status}` };
      }
      const payload = await readJsonResponse(response);
      const containerId = typeof payload.id === "string" ? payload.id : undefined;
      if (!containerId) {
        return { ok: false, reason: "instagram_graph_media_missing_id" };
      }
      return { ok: true, containerId };
    } catch (error) {
      return { ok: false, reason: `instagram_graph_media_failed:${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async publishMediaContainer(
    auth: string,
    businessAccountId: string,
    containerId: string
  ): Promise<{ ok: true; mediaId: string } | { ok: false; reason: string }> {
    try {
      const response = await this.fetchImpl(`${GRAPH_API_BASE_URL}/${businessAccountId}/media_publish`, {
        method: "POST",
        headers: buildJsonHeaders(),
        body: JSON.stringify({
          access_token: auth,
          creation_id: containerId
        })
      });
      if (!response.ok) {
        return { ok: false, reason: `instagram_graph_publish_failed_${response.status}` };
      }
      const payload = await readJsonResponse(response);
      const mediaId = typeof payload.id === "string" ? payload.id : undefined;
      if (!mediaId) {
        return { ok: false, reason: "instagram_graph_publish_missing_id" };
      }
      return { ok: true, mediaId };
    } catch (error) {
      return { ok: false, reason: `instagram_graph_publish_failed:${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private readBusinessAccountId(account: Record<string, unknown> | undefined): string | undefined {
    if (!account) {
      return undefined;
    }
    const instagramBusinessAccount = account.instagram_business_account;
    if (instagramBusinessAccount && typeof instagramBusinessAccount === "object" && "id" in instagramBusinessAccount) {
      const id = instagramBusinessAccount.id;
      if (typeof id === "string") {
        return id;
      }
    }
    const connectedInstagramAccount = account.connected_instagram_account;
    if (connectedInstagramAccount && typeof connectedInstagramAccount === "object" && "id" in connectedInstagramAccount) {
      const id = connectedInstagramAccount.id;
      if (typeof id === "string") {
        return id;
      }
    }
    return undefined;
  }
}
