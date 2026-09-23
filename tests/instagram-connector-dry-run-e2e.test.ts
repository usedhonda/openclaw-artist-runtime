import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramConnector } from "../src/connectors/social/instagramConnector";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

async function publishWith(fetchMock: typeof fetch) {
  vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "ig-token");
  const connector = new InstagramConnector(fetchMock);
  return connector.publish({
    dryRun: true,
    authority: "auto_publish_visuals",
    postType: "lyric_card",
    text: "dry-run visual",
    mediaPaths: ["https://example.com/card.png"]
  });
}

describe("InstagramConnector dry-run Graph API E2E", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs accounts, media, and publish stages in dry-run while keeping accepted false", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "page-1", instagram_business_account: { id: "ig-1" } }] }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "media-1" }));

    await expect(publishWith(fetchMock)).resolves.toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "dry-run blocks publish",
      raw: {
        pageId: "page-1",
        businessAccountId: "ig-1",
        containerId: "container-1",
        publishedMediaId: "media-1",
        stageOrder: ["accounts", "media", "publish"]
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    [401, "instagram_graph_accounts_failed_401"],
    [403, "instagram_graph_accounts_failed_403"],
    [429, "instagram_graph_accounts_failed_429"],
    [500, "instagram_graph_accounts_failed_500"]
  ])("maps accounts stage HTTP %i to %s", async (status, reason) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "nope" }, status));

    await expect(publishWith(fetchMock)).resolves.toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps media container stage failures and does not call publish", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "page-1", instagram_business_account: { id: "ig-1" } }] }))
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429));

    await expect(publishWith(fetchMock)).resolves.toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "instagram_graph_media_failed_429",
      raw: {
        businessAccountId: "ig-1",
        pageId: "page-1"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps publish stage failures after container creation", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "page-1", instagram_business_account: { id: "ig-1" } }] }))
      .mockResolvedValueOnce(jsonResponse({ id: "container-1" }))
      .mockResolvedValueOnce(jsonResponse({ error: "server down" }, 500));

    await expect(publishWith(fetchMock)).resolves.toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "instagram_graph_publish_failed_500",
      raw: {
        businessAccountId: "ig-1",
        pageId: "page-1",
        containerId: "container-1"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects live mode before Graph fetch is reached", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "ig-token");
    const fetchMock = vi.fn<typeof fetch>();
    const connector = new InstagramConnector(fetchMock);

    await expect(connector.publish({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      text: "live blocked",
      mediaPaths: ["https://example.com/card.png"]
    })).resolves.toEqual({
      accepted: false,
      platform: "instagram",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
