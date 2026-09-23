import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatusResponse } from "../../src/routes";
import { ensureArtistWorkspace } from "../../src/services/artistWorkspace";
import { createSongIdea } from "../../src/services/songIdeation";
import type { SocialPublishLedgerEntry } from "../../src/types";

async function prepareWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-distribution-events-"));
  await ensureArtistWorkspace(root);
  await createSongIdea({ workspaceRoot: root, artistReason: "distribution event test" });
  return root;
}

async function writeSocialLedger(root: string, songId: string, entries: SocialPublishLedgerEntry[]): Promise<void> {
  await mkdir(join(root, "songs", songId, "social"), { recursive: true });
  await writeFile(
    join(root, "songs", songId, "social", "social-publish.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );
}

function entry(index: number, overrides: Partial<SocialPublishLedgerEntry> = {}): SocialPublishLedgerEntry {
  return {
    timestamp: `2026-04-${(index + 1).toString().padStart(2, "0")}T00:00:00.000Z`,
    platform: "x",
    connector: "x",
    songId: "song-001",
    postType: "observation",
    action: "publish",
    accepted: false,
    dryRun: true,
    mediaRefs: [],
    reason: "dry-run blocks social publish",
    ...overrides
  };
}

describe("/api/status distribution events", () => {
  it("returns an empty event list when no social ledger exists", async () => {
    const root = await prepareWorkspace();

    const status = await buildStatusResponse({ artist: { workspaceRoot: root } });

    expect(status.recentDistributionEvents).toEqual([]);
  });

  it("sorts recent distribution events and truncates them to 20", async () => {
    const root = await prepareWorkspace();
    await writeSocialLedger(root, "song-001", Array.from({ length: 25 }, (_, index) => entry(index)));

    const status = await buildStatusResponse({ artist: { workspaceRoot: root } });

    expect(status.recentDistributionEvents).toHaveLength(20);
    expect(status.recentDistributionEvents[0]?.timestamp).toBe("2026-04-25T00:00:00.000Z");
    expect(status.recentDistributionEvents.at(-1)?.timestamp).toBe("2026-04-06T00:00:00.000Z");
  });

  it("keeps TikTok frozen reasons visible in the recent events surface", async () => {
    const root = await prepareWorkspace();
    await writeSocialLedger(root, "song-001", [
      entry(0, {
        platform: "tiktok",
        connector: "tiktok",
        reason: "account_not_created"
      })
    ]);

    const status = await buildStatusResponse({ artist: { workspaceRoot: root } });

    expect(status.recentDistributionEvents[0]).toMatchObject({
      platform: "tiktok",
      reason: "account_not_created"
    });
  });
});
