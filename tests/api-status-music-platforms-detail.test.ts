import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatusResponse } from "../src/routes";
import { recordBirdCall, triggerCooldown } from "../src/services/birdRateLimiter";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";

describe("music and platform status details", () => {
  it("surfaces Bird ledger detail and distribution detection checks", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-detail-"));
    await ensureArtistWorkspace(root);
    const birdNow = new Date();

    await recordBirdCall(root, birdNow, {
      query: "rail noise",
      mode: "topical"
    });
    await triggerCooldown(root, "rate limit smoke", birdNow);

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root }
    });

    expect(status.bird?.ledger).toMatchObject({
      todayCalls: [
        {
          timestamp: birdNow.toISOString(),
          query: "rail noise",
          mode: "topical"
        }
      ],
      cooldown: {
        reason: "rate limit smoke"
      }
    });
    expect(status.bird?.ledger?.cooldown.until).toEqual(expect.any(String));
    expect(status.distribution?.detected.unitedMasters?.lastCheckedAt).toEqual(expect.any(String));
    expect(status.distribution?.detected.spotify?.lastCheckedAt).toEqual(expect.any(String));
    expect(status.distribution?.detected.appleMusic?.lastCheckedAt).toEqual(expect.any(String));
  });
});
