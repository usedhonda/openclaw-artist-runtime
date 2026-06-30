import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlatformStats, readDistributionEvents, readDistributionEventsWithDiagnostics } from "../src/services/distributionLedgerReader";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { getSocialLedgerArchivePath, getSocialLedgerPath } from "../src/services/socialPublishLedger";
import { createSongIdea } from "../src/services/songIdeation";
import type { SocialPublishLedgerEntry } from "../src/types";

async function prepareRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-distribution-reader-"));
  await ensureArtistWorkspace(root);
  await createSongIdea({ workspaceRoot: root, artistReason: "archive reader test" });
  await mkdir(join(root, "songs", "song-001", "social"), { recursive: true });
  return root;
}

function entry(timestamp: string, reason: string): SocialPublishLedgerEntry {
  return {
    timestamp,
    platform: "instagram",
    connector: "instagram",
    songId: "song-001",
    postType: "lyric_card",
    action: "publish",
    accepted: reason === "ok",
    dryRun: true,
    mediaRefs: [],
    reason
  };
}

async function writeJsonl(path: string, entries: SocialPublishLedgerEntry[]): Promise<void> {
  await writeFile(path, `${entries.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

describe("distribution ledger reader archive support", () => {
  it("excludes archive entries by default and includes them when requested", async () => {
    const root = await prepareRoot();
    await writeJsonl(getSocialLedgerPath(root, "song-001"), [entry("2026-04-24T00:00:00.000Z", "active")]);
    await writeJsonl(getSocialLedgerArchivePath(root, "song-001"), [entry("2026-04-01T00:00:00.000Z", "archived")]);

    await expect(readDistributionEvents(root, 20)).resolves.toHaveLength(1);
    const withArchive = await readDistributionEvents(root, 20, { includeArchive: true });

    expect(withArchive.map((record) => record.reason)).toEqual(["active", "archived"]);
  });

  it("uses archive entries in stats only when includeArchive is true", async () => {
    const root = await prepareRoot();
    await writeJsonl(getSocialLedgerPath(root, "song-001"), [entry("2026-04-24T00:00:00.000Z", "ok")]);
    await writeJsonl(getSocialLedgerArchivePath(root, "song-001"), [
      entry("2026-04-23T00:00:00.000Z", "instagram_graph_accounts_failed_401")
    ]);

    const activeOnly = await buildPlatformStats(root, new Date("2026-04-24T23:00:00.000Z"));
    const withArchive = await buildPlatformStats(root, new Date("2026-04-24T23:00:00.000Z"), { includeArchive: true });

    expect(activeOnly.instagram.count7d).toBe(1);
    expect(withArchive.instagram.count7d).toBe(2);
    expect(withArchive.instagram.failedReasons).toEqual({
      instagram_graph_accounts_failed_401: 1
    });
  });

  it("skips corrupt ledger rows and reports an error count", async () => {
    const root = await prepareRoot();
    const first = entry("2026-04-24T00:00:00.000Z", "ok");
    const second = entry("2026-04-24T01:00:00.000Z", "active");
    await writeFile(getSocialLedgerPath(root, "song-001"), [
      JSON.stringify(first),
      "{not json",
      JSON.stringify(second),
      ""
    ].join("\n"), "utf8");

    const result = await readDistributionEventsWithDiagnostics(root, 20);

    expect(result.errorCount).toBe(1);
    expect(result.events.map((record) => record.reason)).toEqual(["active", "ok"]);
    await expect(readDistributionEvents(root, 20)).resolves.toHaveLength(2);
  });
});
