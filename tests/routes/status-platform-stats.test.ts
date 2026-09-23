import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlatformStats } from "../../src/services/distributionLedgerReader";
import { ensureArtistWorkspace } from "../../src/services/artistWorkspace";
import { createSongIdea } from "../../src/services/songIdeation";
import type { SocialPublishLedgerEntry } from "../../src/types";

async function prepareWorkspace(prefix: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  await ensureArtistWorkspace(root);
  await createSongIdea({ workspaceRoot: root, artistReason: "platform stats test" });
  return root;
}

async function writeSocialLedger(root: string, entries: SocialPublishLedgerEntry[]): Promise<void> {
  await mkdir(join(root, "songs", "song-001", "social"), { recursive: true });
  await writeFile(
    join(root, "songs", "song-001", "social", "social-publish.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );
}

function entry(timestamp: string, overrides: Partial<SocialPublishLedgerEntry> = {}): SocialPublishLedgerEntry {
  return {
    timestamp,
    platform: "instagram",
    connector: "instagram",
    songId: "song-001",
    postType: "lyric_card",
    action: "publish",
    accepted: true,
    dryRun: true,
    mediaRefs: [],
    reason: "dry-run blocks publish",
    ...overrides
  };
}

describe("platform stats status aggregation", () => {
  it("calculates 7 day counts, success rate, and failed reasons", async () => {
    const root = await prepareWorkspace("artist-runtime-platform-stats-");
    await writeSocialLedger(root, [
      entry("2026-04-24T12:00:00.000Z"),
      entry("2026-04-23T12:00:00.000Z", { accepted: false, reason: "instagram_graph_accounts_failed_401" }),
      entry("2026-04-22T12:00:00.000Z", { platform: "x", connector: "x", accepted: false, reason: "requires_explicit_live_go" }),
      entry("2026-04-10T12:00:00.000Z", { accepted: true })
    ]);

    const stats = await buildPlatformStats(root, new Date("2026-04-24T23:00:00.000Z"));

    expect(stats.instagram.count7d).toBe(2);
    expect(stats.instagram.accepted7d).toBe(1);
    expect(stats.instagram.successRate).toBe(0.5);
    expect(stats.instagram.failedReasons).toEqual({
      instagram_graph_accounts_failed_401: 1
    });
    expect(stats.instagram.dailyCounts.reduce((sum, value) => sum + value, 0)).toBe(2);
    expect(stats.x.count7d).toBe(1);
  });

  it("keeps events outside the 7 day window out of platform stats", async () => {
    const root = await prepareWorkspace("artist-runtime-platform-stats-old-");
    await writeSocialLedger(root, [
      entry("2026-04-01T12:00:00.000Z", { platform: "x", connector: "x" })
    ]);

    const stats = await buildPlatformStats(root, new Date("2026-04-24T23:00:00.000Z"));

    expect(stats.x.count7d).toBe(0);
    expect(stats.x.successRate).toBe(0);
    expect(stats.x.dailyCounts).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
