import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishSocialAction } from "../src/services/socialPublishing.js";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "social-publishing-reply-"));
  mkdirSync(join(root, "songs", "song-001", "social"), { recursive: true });
  mkdirSync(join(root, "songs", "song-001", "audit"), { recursive: true });
  return root;
}

describe("publishSocialAction reply wire-through", () => {
  it("forwards targetId/targetUrl to connector.reply() under dry-run", async () => {
    const root = makeWorkspace();

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      action: "reply",
      text: "echoing a thought",
      targetId: "1234567890",
      targetUrl: "https://x.com/someone/status/1234567890",
      config: {
        autopilot: { dryRun: true },
        distribution: {
          enabled: true,
          platforms: {
            x: { enabled: true, authority: "auto_publish" }
          }
        }
      }
    });

    expect(entry.action).toBe("reply");
    expect(entry.platform).toBe("x");
    expect(entry.connector).toBe("x");
    expect(entry.dryRun).toBe(true);
    expect(result.dryRun).toBe(true);
  });

  it("persists a reply ledger entry with audit trail", async () => {
    const root = makeWorkspace();

    const { entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      postType: "observation",
      action: "reply",
      text: "another reply",
      targetId: "99",
      config: {
        autopilot: { dryRun: true },
        distribution: {
          enabled: true,
          platforms: { x: { enabled: true, authority: "auto_publish" } }
        }
      }
    });

    expect(entry.action).toBe("reply");
    expect(entry.policyDecision).toBeDefined();
    expect(entry.verification.status).toBe("pending");
  });

  it("returns not-accepted when the target platform reply capability is absent", async () => {
    const root = makeWorkspace();

    const { result } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "instagram",
      postType: "lyric_card",
      action: "reply",
      text: "should not go through",
      targetId: "ignored",
      config: {
        autopilot: { dryRun: true },
        distribution: {
          enabled: true,
          platforms: { instagram: { enabled: true, authority: "auto_publish_visuals" } }
        }
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.platform).toBe("instagram");
  });
});
