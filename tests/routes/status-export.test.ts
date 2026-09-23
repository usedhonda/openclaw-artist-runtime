import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatusExportResponse } from "../../src/routes";
import { ensureArtistWorkspace } from "../../src/services/artistWorkspace";
import { getSocialLedgerArchivePath, getSocialLedgerPath } from "../../src/services/socialPublishLedger";
import { createSongIdea } from "../../src/services/songIdeation";
import type { SocialPublishLedgerEntry } from "../../src/types";

async function prepareWorkspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-status-export-"));
  await ensureArtistWorkspace(root);
  await createSongIdea({ workspaceRoot: root, artistReason: "status export test" });
  return root;
}

async function writeJsonl(path: string, entries: SocialPublishLedgerEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function entry(timestamp: string, overrides: Partial<SocialPublishLedgerEntry> = {}): SocialPublishLedgerEntry {
  return {
    timestamp,
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

describe("/api/status/export", () => {
  it("exports status plus only 7 day ledger events by default", async () => {
    const root = await prepareWorkspace();
    await writeJsonl(getSocialLedgerPath(root, "song-001"), [
      entry("2026-04-24T12:00:00.000Z"),
      entry("2026-04-10T12:00:00.000Z", { reason: "older_than_7d" })
    ]);

    const exported = await buildStatusExportResponse(
      { artist: { workspaceRoot: root } },
      "7d",
      new Date("2026-04-24T23:00:00.000Z")
    );

    expect(exported.window).toBe("7d");
    expect(exported.status.config.artist.workspaceRoot).toBe(root);
    expect(exported.ledger.events).toHaveLength(1);
    expect(exported.ledger.events[0]?.timestamp).toBe("2026-04-24T12:00:00.000Z");
    expect(exported.ledger.platformStats.x.count7d).toBe(1);
  });

  it("exports 30 day ledger windows without pulling archive-only history", async () => {
    const root = await prepareWorkspace();
    await writeJsonl(getSocialLedgerPath(root, "song-001"), [
      entry("2026-04-20T12:00:00.000Z"),
      entry("2026-03-10T12:00:00.000Z", { reason: "older_than_30d" })
    ]);
    await writeJsonl(getSocialLedgerArchivePath(root, "song-001"), [
      entry("2026-04-19T12:00:00.000Z", { reason: "archive_hidden_by_window" })
    ]);

    const exported = await buildStatusExportResponse(
      { artist: { workspaceRoot: root } },
      "30d",
      new Date("2026-04-24T23:00:00.000Z")
    );

    expect(exported.ledger.events.map((event) => event.reason)).toEqual(["dry-run blocks social publish"]);
  });

  it("exports all active and archived ledger history when requested", async () => {
    const root = await prepareWorkspace();
    await writeJsonl(getSocialLedgerPath(root, "song-001"), [
      entry("2026-04-24T12:00:00.000Z", { platform: "instagram", connector: "instagram" })
    ]);
    await writeJsonl(getSocialLedgerArchivePath(root, "song-001"), [
      entry("2025-12-01T12:00:00.000Z", { platform: "tiktok", connector: "tiktok", reason: "account_not_created" })
    ]);

    const exported = await buildStatusExportResponse(
      { artist: { workspaceRoot: root } },
      "all",
      new Date("2026-04-24T23:00:00.000Z")
    );

    expect(exported.window).toBe("all");
    expect(exported.ledger.events.map((event) => event.reason)).toEqual([
      "dry-run blocks social publish",
      "account_not_created"
    ]);
    expect(exported.ledger.events[1]?.platform).toBe("tiktok");
    expect(exported.status.summary).toHaveProperty("allPlatformsEffectivelyDryRun");
  });
});
