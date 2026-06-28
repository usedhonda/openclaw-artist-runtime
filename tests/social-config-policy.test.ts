import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SocialPublishLedgerEntry } from "../src/types";
import { updateSongState } from "../src/services/artistState";
import { appendSocialPublishLedgerEntry } from "../src/services/socialPublishLedger";
import { publishSocialAction } from "../src/services/socialPublishing";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-social-policy-"));
  mkdirSync(join(root, "songs", "song-001", "social"), { recursive: true });
  mkdirSync(join(root, "songs", "song-001", "audit"), { recursive: true });
  return root;
}

function liveXConfig(extra: Record<string, unknown> = {}) {
  return {
    autopilot: { dryRun: false },
    distribution: {
      enabled: true,
      liveGoArmed: true,
      ...extra,
      platforms: {
        x: {
          enabled: true,
          liveGoArmed: true,
          authority: "auto_publish",
          maxPostsPerDay: 3,
          maxRepliesPerDay: 1,
          autoPostTypes: ["observation", "studio_note"],
          ...((extra as { platforms?: { x?: Record<string, unknown> } }).platforms?.x ?? {})
        }
      }
    }
  };
}

function acceptedEntry(songId: string, action: "publish" | "reply" = "publish"): SocialPublishLedgerEntry {
  return {
    timestamp: new Date().toISOString(),
    platform: "x",
    connector: "x",
    songId,
    postType: "observation",
    action,
    accepted: true,
    dryRun: false,
    mediaRefs: [],
    policyDecision: { allowed: true, reason: "test", policyDecision: "allow_publish" },
    verification: { status: "verified", detail: "test" },
    reason: "test"
  };
}

describe("social config policy", () => {
  it("blocks publishing when dailySharing is off or draft_only", async () => {
    const root = makeWorkspace();

    const off = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      text: "cold rail",
      config: liveXConfig({ dailySharing: "off" })
    });
    expect(off.result.reason).toBe("daily sharing is off");
    expect(off.entry.policyDecision?.policyDecision).toBe("deny_daily_sharing_off");

    const draftOnly = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      text: "cold rail again",
      config: liveXConfig({ dailySharing: "draft_only" })
    });
    expect(draftOnly.result.reason).toBe("daily sharing is draft_only");
    expect(draftOnly.entry.policyDecision?.policyDecision).toBe("deny_daily_sharing_draft_only");
  });

  it("blocks disabled post types, forbidden topics, official release posts, and daily caps", async () => {
    const root = makeWorkspace();

    const postType = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "new_song_link",
      text: "new link",
      config: liveXConfig()
    });
    expect(postType.entry.policyDecision?.policyDecision).toBe("deny_post_type");

    const forbidden = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      text: "contains banned_phrase",
      config: { ...liveXConfig(), safety: { forbiddenTopics: ["banned_phrase"] } }
    });
    expect(forbidden.entry.policyDecision?.policyDecision).toBe("deny_forbidden_topic");

    const official = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "official_release",
      text: "release note",
      config: liveXConfig({
        officialRelease: "manual_approval",
        platforms: { x: { autoPostTypes: ["official_release"] } }
      })
    });
    expect(official.entry.policyDecision?.policyDecision).toBe("require_official_release_approval");

    await updateSongState(root, "song-cap", { title: "song-cap" });
    await appendSocialPublishLedgerEntry(root, "song-cap", acceptedEntry("song-cap"));
    const capped = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      text: "cap me",
      config: liveXConfig({ platforms: { x: { maxPostsPerDay: 1 } } })
    });
    expect(capped.entry.policyDecision?.policyDecision).toBe("deny_post_cap");
  });

  it("blocks replies when maxRepliesPerDay is zero", async () => {
    const root = makeWorkspace();
    const reply = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      action: "reply",
      targetId: "123",
      text: "reply",
      config: liveXConfig({ platforms: { x: { authority: "auto_publish_and_low_risk_replies", maxRepliesPerDay: 0 } } })
    });

    expect(reply.result.reason).toBe("x replies are capped at 0/day");
    expect(reply.entry.policyDecision?.policyDecision).toBe("deny_reply_cap");
  });
});
