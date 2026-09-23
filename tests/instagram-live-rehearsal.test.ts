import { afterEach, describe, expect, it, vi } from "vitest";
import { canProceedWithLiveRehearsal, InstagramConnector } from "../src/connectors/social/instagramConnector.js";

function jsonResponse(ok: boolean, status: number, payload: Record<string, unknown>): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as Response;
}

describe("Instagram live rehearsal skeleton", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed and skips fetch when rehearsal is not explicitly armed", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "token");
    const fetchMock = vi.fn();
    const connector = new InstagramConnector(fetchMock as typeof fetch);

    const result = await connector.publish({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      text: "caption",
      mediaPaths: ["https://cdn.example/cover.jpg"]
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs mocked accounts/media rehearsal only when all arms and explicit GO are present", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(true, 200, {
        data: [{ id: "page-1", instagram_business_account: { id: "ig-1" } }]
      }))
      .mockResolvedValueOnce(jsonResponse(true, 200, { id: "container-1" }));
    const connector = new InstagramConnector(fetchMock as typeof fetch);

    const result = await connector.publish({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      text: "caption",
      mediaPaths: ["https://cdn.example/cover.jpg"],
      globalLiveGoArmed: true,
      platformLiveGoArmed: true,
      liveRehearsalArmed: true,
      liveRehearsalExplicitGo: true
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/me/accounts");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/ig-1/media");
    expect(result).toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: false,
      reason: "requires_explicit_live_go",
      raw: {
        stageOrder: ["accounts", "media", "publish_blocked"],
        liveRehearsal: true
      }
    });
  });

  it("keeps publish-stage media_publish unreachable during live rehearsal", async () => {
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(true, 200, {
        data: [{ id: "page-1", instagram_business_account: { id: "ig-1" } }]
      }))
      .mockResolvedValueOnce(jsonResponse(true, 200, { id: "container-1" }));
    const connector = new InstagramConnector(fetchMock as typeof fetch);

    await connector.publish({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      text: "caption",
      mediaPaths: ["https://cdn.example/cover.jpg"],
      globalLiveGoArmed: true,
      platformLiveGoArmed: true,
      liveRehearsalArmed: true,
      liveRehearsalExplicitGo: true
    });

    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("media_publish"))).toBe(false);
  });

  it("exposes the rehearsal AND gate as fail-closed unless every condition is true", () => {
    expect(canProceedWithLiveRehearsal({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      globalLiveGoArmed: true,
      platformLiveGoArmed: true,
      liveRehearsalArmed: true,
      liveRehearsalExplicitGo: true
    })).toBe(true);
    expect(canProceedWithLiveRehearsal({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "lyric_card",
      globalLiveGoArmed: true,
      platformLiveGoArmed: true,
      liveRehearsalArmed: true
    })).toBe(false);
  });
});
