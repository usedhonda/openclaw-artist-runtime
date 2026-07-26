import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendSocialReplyLedgerEntry,
  appendSocialPublishLedgerEntry,
  getSocialLedgerArchivePath,
  getSocialLedgerPath,
  readLatestSocialPublishLedgerEntry
} from "../src/services/socialPublishLedger";
import type { SocialPublishLedgerEntry } from "../src/types";

const FIXED_NOW = new Date("2026-04-24T00:00:00.000Z");

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-social-ledger-"));
}

function entry(timestamp: string, reason = "dry-run blocks social publish"): SocialPublishLedgerEntry {
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
    reason
  };
}

function readJsonl(path: string): SocialPublishLedgerEntry[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as SocialPublishLedgerEntry);
}

describe("social publish ledger writer", () => {
  it("writes a complete JSONL ledger through the atomic path", async () => {
    const root = makeRoot();

    await appendSocialPublishLedgerEntry(root, "song-001", entry("2026-04-24T00:00:00.000Z"), { now: FIXED_NOW });

    const ledgerPath = getSocialLedgerPath(root, "song-001");
    expect(readJsonl(ledgerPath)).toHaveLength(1);
    expect(existsSync(`${ledgerPath}.tmp`)).toBe(false);
  });

  it("silently removes stale tmp files on the next append", async () => {
    const root = makeRoot();
    const ledgerPath = getSocialLedgerPath(root, "song-001");
    await mkdir(join(root, "songs", "song-001", "social"), { recursive: true });
    await writeFile(`${ledgerPath}.tmp`, "{partial", "utf8");

    await appendSocialPublishLedgerEntry(root, "song-001", entry("2026-04-24T00:00:00.000Z"), { now: FIXED_NOW });

    expect(existsSync(`${ledgerPath}.tmp`)).toBe(false);
    expect(readJsonl(ledgerPath)[0]?.reason).toBe("dry-run blocks social publish");
  });

  it("rotates entries older than 90 days into the archive ledger", async () => {
    const root = makeRoot();
    const oldEntry = entry("2026-01-01T00:00:00.000Z", "old");
    const freshEntry = entry("2026-04-24T00:00:00.000Z", "fresh");

    await appendSocialPublishLedgerEntry(root, "song-001", oldEntry, { now: new Date("2026-04-24T00:00:00.000Z") });
    await appendSocialPublishLedgerEntry(root, "song-001", freshEntry, { now: new Date("2026-04-24T00:00:00.000Z") });

    expect(readJsonl(getSocialLedgerPath(root, "song-001")).map((record) => record.reason)).toEqual(["fresh"]);
    expect(readJsonl(getSocialLedgerArchivePath(root, "song-001")).map((record) => record.reason)).toEqual(["old"]);
  });

  it("keeps the latest active entry readable after rotation", async () => {
    const root = makeRoot();

    await appendSocialPublishLedgerEntry(root, "song-001", entry("2026-04-24T00:00:00.000Z", "latest"), { now: FIXED_NOW });

    await expect(readLatestSocialPublishLedgerEntry(root, "song-001")).resolves.toMatchObject({
      reason: "latest"
    });
  });

  it("serializes concurrent appends for the same social ledger", async () => {
    const root = makeRoot();

    await Promise.all([
      appendSocialPublishLedgerEntry(root, "song-001", entry("2026-04-24T00:00:00.000Z", "one"), { now: FIXED_NOW }),
      appendSocialPublishLedgerEntry(root, "song-001", entry("2026-04-24T00:00:01.000Z", "two"), { now: FIXED_NOW }),
      appendSocialPublishLedgerEntry(root, "song-001", entry("2026-04-24T00:00:02.000Z", "three"), { now: FIXED_NOW })
    ]);

    expect(readJsonl(getSocialLedgerPath(root, "song-001")).map((record) => record.reason)).toEqual(["one", "two", "three"]);
  });

  it("accepts normalized reply entries through the reply append helper", async () => {
    const root = makeRoot();
    const replyEntry: SocialPublishLedgerEntry = {
      ...entry("2026-04-24T00:00:00.000Z", "dry-run blocks social publish"),
      postType: "reply",
      action: "reply",
      replyTarget: {
        type: "reply",
        targetId: "1234567890",
        resolvedFrom: "https://x.com/ghost/status/1234567890",
        dryRun: true,
        timestamp: "2026-04-24T00:00:00.000Z"
      }
    };

    await appendSocialReplyLedgerEntry(root, "song-001", replyEntry, { now: FIXED_NOW });

    expect(readJsonl(getSocialLedgerPath(root, "song-001"))[0]).toMatchObject({
      action: "reply",
      replyTarget: {
        type: "reply",
        targetId: "1234567890",
        dryRun: true
      }
    });
  });

  it("rejects non-reply entries through the reply append helper", async () => {
    await expect(
      appendSocialReplyLedgerEntry(makeRoot(), "song-001", entry("2026-04-24T00:00:00.000Z"))
    ).rejects.toThrow("reply ledger entries must include action=reply and replyTarget.type=reply");
  });
});
