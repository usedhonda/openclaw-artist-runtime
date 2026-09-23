import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishSocialAction } from "../src/services/socialPublishing.js";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "x-reply-audit-"));
  mkdirSync(join(root, "songs", "song-001", "social"), { recursive: true });
  mkdirSync(join(root, "songs", "song-001", "audit"), { recursive: true });
  return root;
}

const originalTcoFetchEnabled = process.env.OPENCLAW_X_TCO_FETCH_ENABLED;

afterEach(() => {
  if (originalTcoFetchEnabled === undefined) {
    delete process.env.OPENCLAW_X_TCO_FETCH_ENABLED;
  } else {
    process.env.OPENCLAW_X_TCO_FETCH_ENABLED = originalTcoFetchEnabled;
  }
  vi.unstubAllGlobals();
});

describe("X reply audit trail", () => {
  it("persists resolved target details for dry-run replies", async () => {
    const root = makeWorkspace();

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      action: "reply",
      postType: "reply",
      text: "reply stays dry",
      targetUrl: "https://x.com/ghost/status/1234567890",
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

    expect(result).toMatchObject({
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: "dry-run blocks social publish"
    });
    expect(entry.replyTarget).toMatchObject({
      type: "reply",
      targetId: "1234567890",
      resolvedFrom: "https://x.com/ghost/status/1234567890",
      dryRun: true
    });

    const ledger = readFileSync(join(root, "songs", "song-001", "social", "social-publish.jsonl"), "utf8");
    expect(ledger).toContain("\"replyTarget\"");
    expect(ledger).toContain("\"targetId\":\"1234567890\"");
  });

  it("persists t.co-expanded target details only when prod expansion is explicitly enabled", async () => {
    process.env.OPENCLAW_X_TCO_FETCH_ENABLED = "1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      url: "https://x.com/ghost/status/2222222222",
      headers: new Headers()
    }));
    const root = makeWorkspace();

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      action: "reply",
      postType: "reply",
      text: "reply stays dry",
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

    expect(result).toMatchObject({
      accepted: false,
      platform: "x",
      dryRun: true,
      reason: "dry-run blocks social publish"
    });
    expect(entry.replyTarget).toMatchObject({
      type: "reply",
      targetId: "2222222222",
      resolvedFrom: "https://t.co/ghost",
      dryRun: true
    });

    const ledger = readFileSync(join(root, "songs", "song-001", "social", "social-publish.jsonl"), "utf8");
    expect(ledger).toContain("\"replyTarget\"");
    expect(ledger).toContain("\"targetId\":\"2222222222\"");
  });

  it("persists fail-closed reply target resolution reasons in the ledger", async () => {
    const root = makeWorkspace();

    const { entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      action: "reply",
      postType: "reply",
      text: "reply stays dry",
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

    expect(entry.replyTarget).toMatchObject({
      type: "reply",
      resolvedFrom: "https://t.co/ghost",
      resolutionReason: "reply_target_tco_requires_fetch",
      dryRun: true
    });
    const ledger = readFileSync(join(root, "songs", "song-001", "social", "social-publish.jsonl"), "utf8");
    expect(ledger).toContain("\"resolutionReason\":\"reply_target_tco_requires_fetch\"");
  });

  it("keeps live replies fail-closed before Bird can run", async () => {
    const root = makeWorkspace();

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: "song-001",
      platform: "x",
      action: "reply",
      postType: "reply",
      text: "do not send",
      targetId: "1234567890",
      config: {
        autopilot: { dryRun: false },
        distribution: {
          enabled: true,
          liveGoArmed: true,
          platforms: {
            x: { enabled: true, liveGoArmed: true, authority: "auto_publish_and_low_risk_replies", maxRepliesPerDay: 1 }
          }
        }
      }
    });

    expect(result).toMatchObject({
      accepted: false,
      platform: "x",
      dryRun: false,
      reason: "requires_explicit_live_go"
    });
    expect(entry.replyTarget).toBeUndefined();
  });
});
