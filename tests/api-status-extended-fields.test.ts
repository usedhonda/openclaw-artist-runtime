import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatusResponse } from "../src/routes";
import { createConversationalSession } from "../src/services/conversationalSession";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { recordBirdCall } from "../src/services/birdRateLimiter";
import { SunoBudgetTracker } from "../src/services/sunoBudget";

describe("extended status fields", () => {
  it("surfaces suno budget, bird rate limits, distribution detection stub, and pending approvals", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-extended-"));
    await ensureArtistWorkspace(root);
    await new SunoBudgetTracker(root).reserve(1, 4);
    await recordBirdCall(root, new Date());
    await createConversationalSession(root, {
      chatId: 1,
      userId: 2,
      topic: { kind: "persona" },
      pendingChangeSet: {
        id: "changeset-persona-test",
        domain: "persona",
        summary: "Persona change awaiting producer approval.",
        fields: [
          {
            domain: "persona",
            targetFile: "ARTIST.md",
            field: "socialVoice",
            proposedValue: "short and sharp",
            status: "proposed"
          }
        ],
        warnings: [],
        createdAt: "2026-04-29T01:02:00.000Z",
        source: "conversation"
      },
      now: Date.now()
    });

    const status = await buildStatusResponse({
      artist: { workspaceRoot: root },
      music: { suno: { dailyCreditLimit: 4 } }
    });

    expect(status.suno.budget).toMatchObject({
      consumed: 1,
      remaining: 3,
      limit: 4
    });
    expect(status.bird?.rateLimit).toMatchObject({
      todayCalls: 1,
      dailyMax: 5,
      minIntervalMinutes: 60
    });
    expect(status.distribution?.detected.spotify?.lastCheckedAt).toEqual(expect.any(String));
    expect(status.pendingApprovals).toMatchObject({
      count: 1,
      recent: [
        {
          id: "changeset-persona-test",
          domain: "persona",
          summary: "Persona change awaiting producer approval.",
          fieldCount: 1,
          createdAt: "2026-04-29T01:02:00.000Z"
        }
      ]
    });
  });
});
