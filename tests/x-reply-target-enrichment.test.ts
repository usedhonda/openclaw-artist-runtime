import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishSocialAction } from "../src/services/socialPublishing.js";
import { extractMentionedHandles, extractTweetIdFromUrl } from "../src/connectors/social/xMediaMetadata.js";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "x-reply-enrich-"));
  mkdirSync(join(root, "songs", "song-001", "social"), { recursive: true });
  mkdirSync(join(root, "songs", "song-001", "audit"), { recursive: true });
  return root;
}

describe("X reply target enrichment helpers", () => {
  it("extracts unique mentioned handles from text", () => {
    expect(extractMentionedHandles("Hi @alice and @bob, also @alice again")).toEqual(["alice", "bob"]);
  });

  it("ignores email-like @ patterns", () => {
    expect(extractMentionedHandles("Contact me at me@example.com or @alice")).toEqual(["alice"]);
  });

  it("extracts tweet id from a status URL", () => {
    expect(extractTweetIdFromUrl("https://x.com/ghost/status/1234567890")).toBe("1234567890");
    expect(extractTweetIdFromUrl(undefined)).toBeUndefined();
  });
});

describe("X reply target enrichment in dry-run audit", () => {
  it("appends mentionedHandles and tweetId to the reply ledger entry", async () => {
    const root = makeWorkspace();
    const { entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      action: "reply",
      postType: "reply",
      text: "Thanks @alice and @bob!",
      targetUrl: "https://x.com/ghost/status/9876543210",
      config: {
        autopilot: { dryRun: true },
        distribution: {
          enabled: true,
          platforms: {
            x: { enabled: true, authority: "auto_publish_and_low_risk_replies" }
          }
        }
      }
    });

    expect(entry.replyTarget).toMatchObject({
      type: "reply",
      targetId: "9876543210",
      tweetId: "9876543210",
      mentionedHandles: ["alice", "bob"]
    });

    const ledger = readFileSync(join(root, "songs", "song-001", "social", "social-publish.jsonl"), "utf8");
    expect(ledger).toContain("\"mentionedHandles\":[\"alice\",\"bob\"]");
    expect(ledger).toContain("\"tweetId\":\"9876543210\"");
  });

  it("omits mentionedHandles when text has none, and keeps tweetId from targetUrl when resolution fails", async () => {
    const root = makeWorkspace();
    const { entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      action: "reply",
      postType: "reply",
      text: "no mentions here",
      targetUrl: "https://t.co/ghost",
      config: {
        autopilot: { dryRun: true },
        distribution: {
          enabled: true,
          platforms: {
            x: { enabled: true, authority: "auto_publish_and_low_risk_replies" }
          }
        }
      }
    });

    expect(entry.replyTarget?.mentionedHandles).toBeUndefined();
    expect(entry.replyTarget?.resolutionReason).toBe("reply_target_tco_requires_fetch");
    expect(entry.replyTarget?.tweetId).toBeUndefined();
  });
});
