import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupCanonicalPersonaSources } from "../src/services/personaCanonicalCleanup.js";
import { artistPersonaBlockEnd, artistPersonaBlockStart } from "../src/services/personaFileBuilder.js";
import { writeSnapshotPersonaFile } from "../src/services/snapshotPersonaFileBuilder.js";

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "persona-p5c-"));
}

describe("persona P5c canonical controls", () => {
  it("rejects direct snapshot writes to derived identity and internal inner files", async () => {
    const root = makeWorkspace();

    await expect(writeSnapshotPersonaFile(root, "IDENTITY.md", "# IDENTITY.md\nmanual\n")).rejects.toThrow("identity_projection_read_only");
    await expect(writeSnapshotPersonaFile(root, "INNER.md", "# INNER.md\nmanual\n")).rejects.toThrow("inner_projection_read_only");
    await expect(writeSnapshotPersonaFile(root, "PRODUCER.md", "Useful producer preference.")).resolves.toMatchObject({
      path: join(root, "PRODUCER.md")
    });
  });

  it("cleans stale ARTIST owner fields outside the managed block without touching creative text", async () => {
    const root = makeWorkspace();
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "ARTIST.md"),
      [
        "# ARTIST.md",
        "",
        "Artist name: Old Scatter Name",
        "This artist keeps a hand-written shard about Shibuya pressure.",
        "",
        artistPersonaBlockStart,
        "## Artist Concept",
        "",
        "Sharp civic pressure, low bass.",
        artistPersonaBlockEnd,
        "",
        "- producer_callname: boss",
        "A second custom paragraph stays alive."
      ].join("\n"),
      "utf8"
    );

    const result = await cleanupCanonicalPersonaSources(root);
    const artist = await readFile(join(root, "ARTIST.md"), "utf8");
    const manifest = await readFile(join(root, "runtime", "persona-legacy", "manifest.jsonl"), "utf8");

    expect(result.changed).toBe(true);
    expect(artist).not.toContain("Artist name: Old Scatter Name");
    expect(artist).not.toContain("producer_callname: boss");
    expect(artist).toContain("This artist keeps a hand-written shard about Shibuya pressure.");
    expect(artist).toContain("Sharp civic pressure, low bass.");
    expect(artist).toContain("A second custom paragraph stays alive.");
    expect(manifest).toContain("ARTIST.md");
    expect(manifest).toContain("canonical_setup_source_cleanup");
  });

  it("leaves unmarked imported ARTIST creative text untouched", async () => {
    const root = makeWorkspace();
    await writeFile(join(root, "ARTIST.md"), "# ARTIST.md\n\nArtist name: Legacy Import\n\nImported voice body.\n", "utf8");

    const result = await cleanupCanonicalPersonaSources(root);
    const artist = await readFile(join(root, "ARTIST.md"), "utf8");

    expect(result.changed).toBe(false);
    expect(artist).toContain("Artist name: Legacy Import");
    expect(artist).toContain("Imported voice body.");
  });
});
