import { describe, expect, it } from "vitest";
import { createInProcessGateway } from "../harness/inProcessGateway.js";
import { readDistributionEvents } from "../../src/services/distributionLedgerReader.js";

describe("X dry-run reply audit reader chain", () => {
  it("routes a dry-run reply into the social ledger and reads it through the distribution reader", async () => {
    const gateway = await createInProcessGateway();

    try {
      const song = await gateway.request<{ songId: string }>("POST", "/plugins/artist-runtime/api/songs/ideate", {
        title: "Signal Reply Chain",
        artistReason: "operator chain regression"
      });

      const reply = await gateway.request<{
        result: { accepted: boolean; dryRun: boolean; reason: string };
        entry: {
          action: "reply";
          platform: "x";
          dryRun: boolean;
          replyTarget?: { targetId?: string; resolvedFrom?: string; dryRun?: boolean };
        };
      }>("POST", "/plugins/artist-runtime/api/platforms/x/simulate-reply", {
        songId: song.body.songId,
        targetUrl: "https://x.com/test_artist/status/1234567890123456789",
        text: "Dry-run reply from the rust line."
      });

      expect(reply.statusCode).toBe(200);
      expect(reply.body.result.accepted).toBe(false);
      expect(reply.body.result.dryRun).toBe(true);
      expect(reply.body.entry.action).toBe("reply");
      expect(reply.body.entry.platform).toBe("x");
      expect(reply.body.entry.dryRun).toBe(true);
      expect(reply.body.entry.replyTarget?.targetId).toBe("1234567890123456789");
      expect(reply.body.entry.replyTarget?.resolvedFrom).toBe("https://x.com/test_artist/status/1234567890123456789");

      const events = await readDistributionEvents(gateway.workspaceRoot, 20);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        songId: song.body.songId,
        platform: "x",
        action: "reply",
        dryRun: true,
        replyTarget: {
          type: "reply",
          targetId: "1234567890123456789",
          dryRun: true
        }
      });
    } finally {
      await gateway.teardown();
    }
  }, 30_000);
});
