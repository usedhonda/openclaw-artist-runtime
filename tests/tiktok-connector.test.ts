import { afterEach, describe, expect, it, vi } from "vitest";
import { TikTokConnector } from "../src/connectors/social/tiktokConnector.js";

describe("TikTokConnector", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports account_not_created when auth env is missing", async () => {
    vi.stubEnv("OPENCLAW_TIKTOK_AUTH", "");
    vi.stubEnv("OPENCLAW_TIKTOK_ACCESS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());

    const connector = new TikTokConnector();
    await expect(connector.checkConnection()).resolves.toEqual({
      connected: false,
      reason: "account_not_created"
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("stays account_not_created even when auth env is configured", async () => {
    vi.stubEnv("OPENCLAW_TIKTOK_ACCESS_TOKEN", "configured-token");
    vi.stubEnv("OPENCLAW_TIKTOK_AUTH", "");
    vi.stubGlobal("fetch", vi.fn());

    const connector = new TikTokConnector();
    await expect(connector.checkConnection()).resolves.toEqual({
      connected: false,
      reason: "account_not_created"
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("blocks publish in dry-run without external calls", async () => {
    vi.stubEnv("OPENCLAW_TIKTOK_AUTH", "configured-token");
    vi.stubGlobal("fetch", vi.fn());

    const connector = new TikTokConnector();
    await expect(connector.publish({
      dryRun: true,
      authority: "auto_publish_clips",
      postType: "clip",
      text: "dry-run clip",
      mediaPaths: ["clip.mp4"]
    })).resolves.toEqual({
      accepted: false,
      platform: "tiktok",
      dryRun: true,
      reason: "dry-run blocks publish"
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fails closed for reply even when auth is configured", async () => {
    vi.stubEnv("OPENCLAW_TIKTOK_AUTH", "configured-token");
    vi.stubGlobal("fetch", vi.fn());

    const connector = new TikTokConnector();
    await expect(connector.reply?.({
      dryRun: false,
      authority: "auto_publish_clips",
      postType: "comment_reply",
      text: "not supported",
      targetUrl: "https://www.tiktok.com/@someone/video/1"
    })).resolves.toEqual({
      accepted: false,
      platform: "tiktok",
      dryRun: false,
      reason: "tiktok_reply_not_supported"
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
