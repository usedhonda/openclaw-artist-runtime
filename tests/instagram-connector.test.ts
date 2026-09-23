import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramConnector } from "../src/connectors/social/instagramConnector.js";

describe("InstagramConnector", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports not connected when auth env is missing", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "");
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());

    const connector = new InstagramConnector();
    await expect(connector.checkConnection()).resolves.toEqual({
      connected: false,
      reason: "instagram_auth_not_configured"
    });
    await expect(connector.publish({
      dryRun: true,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      text: "dry-run card",
      mediaPaths: ["cover.png"]
    })).resolves.toEqual({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "instagram_auth_not_configured"
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reports connected when auth env is configured", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "configured-token");
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());

    const connector = new InstagramConnector();
    await expect(connector.checkConnection()).resolves.toEqual({
      connected: true,
      accountLabel: "configured_via_env"
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("runs the Graph API skeleton in dry-run and stops before real publish", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "configured-token");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          {
            id: "page-123",
            instagram_business_account: { id: "ig-business-123" }
          }
        ]
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "container-123"
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "media-123"
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const connector = new InstagramConnector();
    await expect(connector.publish({
      dryRun: true,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      text: "dry-run card",
      mediaPaths: ["https://example.com/cover.png"]
    })).resolves.toEqual({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "dry-run blocks publish",
      raw: {
        pageId: "page-123",
        businessAccountId: "ig-business-123",
        containerId: "container-123",
        publishedMediaId: "media-123",
        stageOrder: ["accounts", "media", "publish"]
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/me/accounts");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/ig-business-123/media");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/ig-business-123/media_publish");
  });

  it("rejects non-dry-run publish attempts with requires_explicit_live_go", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "configured-token");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const connector = new InstagramConnector();
    await expect(connector.publish({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      text: "live blocked",
      mediaPaths: ["https://example.com/cover.png"]
    })).resolves.toEqual({
      accepted: false,
      platform: "instagram",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for reply even when auth is configured", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "configured-token");
    vi.stubGlobal("fetch", vi.fn());

    const connector = new InstagramConnector();
    await expect(connector.reply?.({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "comment_reply",
      text: "not supported",
      targetId: "123"
    })).resolves.toEqual({
      accepted: false,
      platform: "instagram",
      dryRun: false,
      reason: "instagram_reply_not_supported"
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
