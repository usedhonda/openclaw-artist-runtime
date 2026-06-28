import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describePersonaSetupReasons, readPersonaSetupStatus } from "../src/services/personaSetupDetector";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-persona-detector-"));
}

async function writeCompletedMarker(root: string, source: "telegram" | "web" = "telegram"): Promise<void> {
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(
    join(root, "runtime", "persona-completed.json"),
    `${JSON.stringify({ completedAt: "2026-04-27T00:00:00.000Z", source, version: 1 })}\n`,
    "utf8"
  );
}

describe("persona setup detector", () => {
  it("requires setup when ARTIST.md is missing and no completion marker exists", async () => {
    const status = await readPersonaSetupStatus(makeRoot());

    expect(status.needsSetup).toBe(true);
    expect(status.completed).toBe(false);
    expect(status.reasons).toContain("missing_completion_marker");
    expect(status.reasons).toContain("missing_artist_file");
  });

  it("requires setup when only legacy name placeholders remain", async () => {
    const root = makeRoot();
    await writeCompletedMarker(root);
    await writeFile(
      join(root, "ARTIST.md"),
      ["# ARTIST.md", "", "Artist name: TBD", "", "```yaml", "name: TBD", "```"].join("\n"),
      "utf8"
    );

    const status = await readPersonaSetupStatus(root);

    expect(status.needsSetup).toBe(true);
    expect(status.reasons).toEqual(expect.arrayContaining(["artist_concept_tbd"]));
  });

  it("does not treat the artist name placeholder as a canonical setup field when artist sections exist", async () => {
    const root = makeRoot();
    await writeCompletedMarker(root);
    await writeFile(
      join(root, "ARTIST.md"),
      ["# ARTIST.md", "", "Artist name: ", "", "## Artist Concept", "", "A public artist built from local observations."].join("\n"),
      "utf8"
    );

    const status = await readPersonaSetupStatus(root);

    expect(status.needsSetup).toBe(false);
    expect(status.reasons).toEqual([]);
  });

  it("treats a completion marker plus customized ARTIST.md as complete", async () => {
    const root = makeRoot();
    await writeCompletedMarker(root);
    await writeFile(
      join(root, "ARTIST.md"),
      ["# ARTIST.md", "", "Artist name: Neon Relay", "", "```yaml", "name: Neon Relay", "```"].join("\n"),
      "utf8"
    );

    const status = await readPersonaSetupStatus(root);

    expect(status.needsSetup).toBe(false);
    expect(status.completed).toBe(true);
    expect(status.reasons).toEqual([]);
  });

  it("does not require duplicate artist name fields in new ARTIST.md", async () => {
    const root = makeRoot();
    await writeCompletedMarker(root);
    await writeFile(
      join(root, "ARTIST.md"),
      ["# ARTIST.md", "", "## Artist Concept", "", "A public artist built from local observations.", "", "## Suno Production Profile", "", "```yaml", "genres:", "  - nu-jazz rap", "```"].join("\n"),
      "utf8"
    );

    const status = await readPersonaSetupStatus(root);

    expect(status.needsSetup).toBe(false);
    expect(status.completed).toBe(true);
    expect(status.reasons).toEqual([]);
  });

  it("accepts web completion markers from the Producer Room setup tab", async () => {
    const root = makeRoot();
    await writeCompletedMarker(root, "web");
    await writeFile(
      join(root, "ARTIST.md"),
      ["# ARTIST.md", "", "Artist name: Web Artist", "", "```yaml", "name: Web Artist", "```"].join("\n"),
      "utf8"
    );

    const status = await readPersonaSetupStatus(root);

    expect(status.completed).toBe(true);
    expect(status.marker?.source).toBe("web");
  });

  it("treats an imported non-default ARTIST.md without a marker as externally completed", async () => {
    const root = makeRoot();
    await writeFile(
      join(root, "ARTIST.md"),
      ["# ARTIST.md", "", "Artist name: Obsidian Artist", "", "```yaml", "name: Obsidian Artist", "```"].join("\n"),
      "utf8"
    );

    const status = await readPersonaSetupStatus(root);

    expect(status.needsSetup).toBe(false);
    expect(status.completed).toBe(true);
    expect(status.reasons).toEqual([]);
  });

  it("can identify an unchanged template by hash", async () => {
    const root = makeRoot();
    const templatePath = join(root, "template-ARTIST.md");
    const template = "# ARTIST.md\n\nArtist name: Custom-looking template\n";
    await writeCompletedMarker(root);
    await writeFile(templatePath, template, "utf8");
    await writeFile(join(root, "ARTIST.md"), template, "utf8");

    const status = await readPersonaSetupStatus(root, { templateArtistPath: templatePath });

    expect(status.needsSetup).toBe(true);
    expect(status.reasons).toContain("matches_default_template_hash");
  });
});

describe("describePersonaSetupReasons", () => {
  it("maps every known reason code to plain operator text", () => {
    expect(
      describePersonaSetupReasons([
        "missing_completion_marker",
        "missing_artist_file",
        "artist_concept_tbd",
        "matches_default_template_hash"
      ])
    ).toBe(
      "setup not completed, ARTIST.md missing, artist concept not set, still the example template"
    );
  });

  it("does not surface raw reason codes for known codes", () => {
    const text = describePersonaSetupReasons(["artist_concept_tbd"]);
    expect(text).not.toContain("artist_concept_tbd");
    expect(text).toBe("artist concept not set");
  });

  it("falls back to the raw value for unknown codes and returns empty text for complete setup", () => {
    expect(describePersonaSetupReasons(["unexpected_code"])).toBe("unexpected_code");
    expect(describePersonaSetupReasons([])).toBe("");
  });
});
