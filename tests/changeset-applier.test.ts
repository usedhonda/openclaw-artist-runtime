import { mkdtempSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChangeSet } from "../src/services/changeSetApplier";
import type { ChangeSetProposal } from "../src/services/freeformChangesetProposer";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { createSongSkeleton } from "../src/repositories/songRepository";
import { readSongState } from "../src/services/artistState";
import { readResolvedConfig } from "../src/services/runtimeConfig";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-changeset-apply-"));
}

function proposal(fields: ChangeSetProposal["fields"], domain: ChangeSetProposal["domain"] = "persona", songId?: string): ChangeSetProposal {
  return {
    id: `test-${domain}`,
    domain,
    summary: "test proposal",
    fields,
    warnings: [],
    createdAt: new Date(0).toISOString(),
    source: "conversation",
    songId
  };
}

describe("changeset applier", () => {
  it("creates one backup set and applies persona fields sequentially", async () => {
    const root = makeRoot();
    await writeFile(join(root, "ARTIST.md"), "# ARTIST.md\n\nArtist name: Old Name\n", "utf8");

    const result = await applyChangeSet(root, proposal([
      { domain: "persona", targetFile: "ARTIST.md", field: "artistName", proposedValue: "New Name", status: "proposed" },
      { domain: "persona", targetFile: "ARTIST.md", field: "obsessions", proposedValue: "cold public transit", status: "proposed" }
    ]));

    const backups = (await readdir(root)).filter((name) => name.includes(".backup-"));
    const artist = await readFile(join(root, "ARTIST.md"), "utf8");
    const config = await readResolvedConfig(root);
    expect(result.applied).toHaveLength(2);
    expect(result.backups.entries).toHaveLength(1);
    expect(backups).toHaveLength(1);
    expect(config.artist.identity.displayName).toBe("New Name");
    expect(artist).not.toContain("Artist name: New Name");
    expect(artist).toContain("cold public transit");
  });

  it("continues after an unsupported field and records a warning", async () => {
    const root = makeRoot();
    await ensureArtistWorkspace(root);
    await createSongSkeleton(root, "where-it-played");

    const result = await applyChangeSet(root, proposal([
      { domain: "song", targetFile: "songs/where-it-played/song.md", field: "status", proposedValue: "published", status: "proposed" },
      { domain: "song", targetFile: "songs/where-it-played/song.md", field: "unknownField", proposedValue: "x", status: "skipped" }
    ], "song", "where-it-played"));

    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("changeset_field_skipped");
    expect((await readSongState(root, "where-it-played")).status).toBe("published");
    await expect(readFile(join(root, "runtime", "changeset-warnings.jsonl"), "utf8")).resolves.toContain("changeset_field_skipped");
  });
});
