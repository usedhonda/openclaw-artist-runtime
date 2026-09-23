import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSongSkeleton } from "../src/repositories/songRepository";
import { appendAuditLog, createAuditEvent, inspectAuditLog } from "../src/services/auditLog";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath, inspectJsonlFile } from "../src/services/promptLedger";

const tempRoots: string[] = [];

describe("repository and ledgers", () => {
  afterEach(() => {
    tempRoots.length = 0;
  });

  it("creates the expected song skeleton", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-song-"));
    tempRoots.push(root);
    const result = await createSongSkeleton(root, "song-001");

    expect(result.basePath).toContain("song-001");
    expect(readFileSync(join(root, "songs", "song-001", "song.md"), "utf8")).toContain("# song-001");
    expect(readFileSync(join(root, "songs", "song-001", "brief.md"), "utf8")).toContain("Brief");
  });

  it("creates workspace files without overwriting existing artist files", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-workspace-"));
    tempRoots.push(root);
    const initial = await ensureArtistWorkspace(root);
    writeFileSync(join(root, "ARTIST.md"), "# custom\n");
    const second = await ensureArtistWorkspace(root);

    expect(initial.created).toContain("ARTIST.md");
    expect(second.skipped).toContain("ARTIST.md");
    expect(readFileSync(join(root, "ARTIST.md"), "utf8")).toBe("# custom\n");
  });

  it("appends prompt ledger entries without overwriting prior lines", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-ledger-"));
    tempRoots.push(root);
    await createSongSkeleton(root, "song-001");
    const ledgerPath = getSongPromptLedgerPath(root, "song-001");

    await appendPromptLedger(
      ledgerPath,
      createPromptLedgerEntry({ stage: "lyrics_generation", songId: "song-001", promptText: "line one" })
    );
    await appendPromptLedger(
      ledgerPath,
      createPromptLedgerEntry({ stage: "suno_payload_build", songId: "song-001", payloadHash: "hash-2" })
    );

    const contents = await readFile(ledgerPath, "utf8");
    expect(contents.trim().split("\n")).toHaveLength(2);
    expect((await inspectJsonlFile(ledgerPath)).healthy).toBe(true);
  });

  it("flags corrupt ledgers as unhealthy", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-corrupt-"));
    tempRoots.push(root);
    const ledgerPath = join(root, "prompt-ledger.jsonl");
    writeFileSync(ledgerPath, "{bad json}\n");

    const health = await inspectJsonlFile(ledgerPath);
    expect(health.healthy).toBe(false);
  });

  it("appends audit log entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-audit-"));
    tempRoots.push(root);
    const auditPath = join(root, "audit.jsonl");

    await appendAuditLog(
      auditPath,
      createAuditEvent({
        eventType: "social_publish",
        actor: "system",
        details: { platform: "x" }
      })
    );

    const health = await inspectAuditLog(auditPath);
    expect(health.healthy).toBe(true);
    expect(health.lineCount).toBe(1);
  });
});
