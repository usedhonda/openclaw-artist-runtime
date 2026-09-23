import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramConnector } from "../src/connectors/social/instagramConnector.js";
import { TikTokConnector } from "../src/connectors/social/tiktokConnector.js";
import { XBirdConnector } from "../src/connectors/social/xBirdConnector.js";
import { publishSocialAction } from "../src/services/socialPublishing.js";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "distribution-authority-wiring-"));
  mkdirSync(join(root, "songs", "song-001", "social"), { recursive: true });
  mkdirSync(join(root, "songs", "song-001", "audit"), { recursive: true });
  return root;
}

function allowInstagramVisualPublishing() {
  return vi.spyOn(InstagramConnector.prototype, "checkCapabilities").mockResolvedValue({
    textPost: false,
    imagePost: true,
    videoPost: true,
    carouselPost: true,
    reelPost: true,
    reply: false,
    quote: false,
    dm: false,
    scheduledPost: false,
    metrics: "unknown"
  });
}

function allowTikTokClipPublishing() {
  return vi.spyOn(TikTokConnector.prototype, "checkCapabilities").mockResolvedValue({
    textPost: false,
    imagePost: false,
    videoPost: true,
    carouselPost: false,
    reelPost: false,
    reply: false,
    quote: false,
    dm: false,
    scheduledPost: false,
    metrics: "unknown"
  });
}

describe("distribution authority wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("forces dry-run hold when distribution is disabled even if authority is auto_publish_visuals", async () => {
    const root = makeWorkspace();
    allowInstagramVisualPublishing();
    const publishSpy = vi.spyOn(InstagramConnector.prototype, "publish");

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "instagram",
      postType: "lyric_card",
      text: "low light, low tide",
      mediaPaths: ["https://example.com/card.png"],
      config: {
        autopilot: { dryRun: false },
        distribution: {
          enabled: false,
          liveGoArmed: true,
          platforms: {
            instagram: { enabled: true, liveGoArmed: true, authority: "auto_publish_visuals" }
          }
        }
      }
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "dry-run blocks social publish"
    });
    expect(entry.dryRun).toBe(true);
    expect(entry.policyDecision?.policyDecision).toBe("deny_dry_run");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("forces dry-run hold when the target platform is disabled even if authority is auto_publish_visuals", async () => {
    const root = makeWorkspace();
    allowInstagramVisualPublishing();
    const publishSpy = vi.spyOn(InstagramConnector.prototype, "publish");

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "instagram",
      postType: "lyric_card",
      text: "ashen neon weather",
      mediaPaths: ["https://example.com/card.png"],
      config: {
        autopilot: { dryRun: false },
        distribution: {
          enabled: true,
          liveGoArmed: true,
          platforms: {
            instagram: { enabled: false, liveGoArmed: true, authority: "auto_publish_visuals" }
          }
        }
      }
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "dry-run blocks social publish"
    });
    expect(entry.dryRun).toBe(true);
    expect(entry.policyDecision?.policyDecision).toBe("deny_dry_run");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("keeps live requests armed only when distribution and platform are enabled, then relies on connector live-go rejection", async () => {
    const root = makeWorkspace();
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "ig-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    allowInstagramVisualPublishing();
    const publishSpy = vi.spyOn(InstagramConnector.prototype, "publish");

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "instagram",
      postType: "lyric_card",
      text: "signal through the dust",
      mediaPaths: ["https://example.com/card.png"],
      config: {
        autopilot: { dryRun: false },
        distribution: {
          enabled: true,
          liveGoArmed: true,
          platforms: {
            instagram: { enabled: true, liveGoArmed: true, authority: "auto_publish_visuals" }
          }
        }
      }
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
    expect(entry.dryRun).toBe(false);
    expect(entry.policyDecision?.policyDecision).toBe("allow_publish");
    expect(publishSpy).toHaveBeenCalledOnce();
    expect(publishSpy.mock.calls[0]?.[0]).toMatchObject({
      dryRun: false,
      authority: "auto_publish_visuals",
      postType: "lyric_card"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forces dry-run hold for every platform while liveGoArmed is false", async () => {
    const root = makeWorkspace();
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("OPENCLAW_TIKTOK_ACCESS_TOKEN", "tt-token");
    allowInstagramVisualPublishing();
    allowTikTokClipPublishing();
    const instagramPublishSpy = vi.spyOn(InstagramConnector.prototype, "publish");
    const xPublishSpy = vi.spyOn(XBirdConnector.prototype, "publish");
    const tiktokPublishSpy = vi.spyOn(TikTokConnector.prototype, "publish");

    const [xAction, instagramAction, tiktokAction] = await Promise.all([
      publishSocialAction({
        workspaceRoot: root,
        songId: "song-001",
        platform: "x",
        postType: "observation",
        text: "ash on the rail line",
        config: {
          autopilot: { dryRun: false },
          distribution: {
            enabled: true,
            liveGoArmed: false,
            platforms: {
              x: { enabled: true, liveGoArmed: true, authority: "auto_publish" }
            }
          }
        }
      }),
      publishSocialAction({
        workspaceRoot: root,
        songId: "song-001",
        platform: "instagram",
        postType: "lyric_card",
        text: "ash on the rail line",
        mediaPaths: ["https://example.com/card.png"],
        config: {
          autopilot: { dryRun: false },
          distribution: {
            enabled: true,
            liveGoArmed: false,
            platforms: {
              instagram: { enabled: true, liveGoArmed: true, authority: "auto_publish_visuals" }
            }
          }
        }
      }),
      publishSocialAction({
        workspaceRoot: root,
        songId: "song-001",
        platform: "tiktok",
        postType: "hook_clip",
        text: "ash on the rail line",
        mediaPaths: ["https://example.com/clip.mp4"],
        config: {
          autopilot: { dryRun: false },
          distribution: {
            enabled: true,
            liveGoArmed: false,
            platforms: {
              tiktok: { enabled: true, liveGoArmed: true, authority: "auto_publish_clips" }
            }
          }
        }
      })
    ]);

    for (const action of [xAction, instagramAction, tiktokAction]) {
      expect(action.result.accepted).toBe(false);
      expect(action.result.dryRun).toBe(true);
      expect(action.result.reason).toBe("dry-run blocks social publish");
      expect(action.entry.dryRun).toBe(true);
      expect(action.entry.policyDecision?.policyDecision).toBe("deny_dry_run");
    }

    expect(xPublishSpy).not.toHaveBeenCalled();
    expect(instagramPublishSpy).not.toHaveBeenCalled();
    expect(tiktokPublishSpy).not.toHaveBeenCalled();
  });

  it("keeps Instagram on dry-run when the global arm is on but the platform arm is off", async () => {
    const root = makeWorkspace();
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "ig-token");
    allowInstagramVisualPublishing();
    const publishSpy = vi.spyOn(InstagramConnector.prototype, "publish");

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "instagram",
      postType: "lyric_card",
      text: "cold halo on the overpass",
      mediaPaths: ["https://example.com/card.png"],
      config: {
        autopilot: { dryRun: false },
        distribution: {
          enabled: true,
          liveGoArmed: true,
          platforms: {
            instagram: { enabled: true, liveGoArmed: false, authority: "auto_publish_visuals" }
          }
        }
      }
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "dry-run blocks social publish"
    });
    expect(entry.dryRun).toBe(true);
    expect(entry.policyDecision?.policyDecision).toBe("deny_dry_run");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("keeps X on dry-run when the global arm is on but the X platform arm is off", async () => {
    const root = makeWorkspace();
    const publishSpy = vi.spyOn(XBirdConnector.prototype, "publish");

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      text: "rust over the antenna field",
      config: {
        autopilot: { dryRun: false },
        distribution: {
          enabled: true,
          liveGoArmed: true,
          platforms: {
            x: { enabled: true, liveGoArmed: false, authority: "auto_publish" }
          }
        }
      }
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: "dry-run blocks social publish"
    });
    expect(entry.dryRun).toBe(true);
    expect(entry.policyDecision?.policyDecision).toBe("deny_dry_run");
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("keeps Instagram on dry-run when the platform arm is on but the global arm is off", async () => {
    const root = makeWorkspace();
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "ig-token");
    allowInstagramVisualPublishing();
    const publishSpy = vi.spyOn(InstagramConnector.prototype, "publish");

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "instagram",
      postType: "lyric_card",
      text: "signal drowned in dusk",
      mediaPaths: ["https://example.com/card.png"],
      config: {
        autopilot: { dryRun: false },
        distribution: {
          enabled: true,
          liveGoArmed: false,
          platforms: {
            instagram: { enabled: true, liveGoArmed: true, authority: "auto_publish_visuals" }
          }
        }
      }
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "instagram",
      dryRun: true,
      reason: "dry-run blocks social publish"
    });
    expect(entry.dryRun).toBe(true);
    expect(entry.policyDecision?.policyDecision).toBe("deny_dry_run");
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
