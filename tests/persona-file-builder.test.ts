import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artistPersonaBlockEnd,
  artistPersonaBlockStart,
  buildArtistPersonaBlock,
  writeArtistPersona,
  writePersonaCompletionMarker
} from "../src/services/personaFileBuilder";

const answers = {
  artistName: "Neon Relay",
  identityLine: "An electronic singer-songwriter built from subway light and failed notifications.",
  soundDna: "ambient pop, glassy synth, close vocal",
  obsessions: "stations, broken ads, private signals",
  lyricsRules: "avoid cheap hope, direct imitation, generic slogans",
  socialVoice: "short, observant, unsalesy"
};

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-persona-builder-"));
}

describe("persona file builder", () => {
  it("builds ARTIST.md sections from six answers without secret-like text", () => {
    const block = buildArtistPersonaBlock(answers);

    expect(block).toContain("## Public Identity");
    expect(block).toContain("## Current Artist Core");
    expect(block).toContain("## Sound");
    expect(block).toContain("## Lyrics");
    expect(block).toContain("## Social Voice");
    expect(block).toContain("## Suno Production Profile");
    expect(block).toContain("Neon Relay");
    expect(block).not.toContain("## Producer Relationship");
    expect(block).not.toMatch(/TOKEN|COOKIE|CREDENTIAL|SECRET|bot\d+:/i);
  });

  it("replaces the default template safely on first-run", async () => {
    const root = makeRoot();
    await writeFile(join(root, "ARTIST.md"), "# ARTIST.md\n\nArtist name: TBD\n\n```yaml\nname: TBD\n```\n", "utf8");

    const result = await writeArtistPersona(root, answers);
    const contents = await readFile(join(root, "ARTIST.md"), "utf8");

    expect(result.mode).toBe("replace_default");
    expect(contents).toContain("# ARTIST.md");
    expect(contents).toContain(artistPersonaBlockStart);
    expect(contents).toContain("Artist name: Neon Relay");
    expect(contents).not.toContain("Artist name: TBD");
  });

  it("updates only an existing managed marker block", async () => {
    const root = makeRoot();
    await writeFile(
      join(root, "ARTIST.md"),
      [
        "# ARTIST.md",
        "",
        "Before stays.",
        artistPersonaBlockStart,
        "old block",
        artistPersonaBlockEnd,
        "",
        "Spotify section stays."
      ].join("\n"),
      "utf8"
    );

    const result = await writeArtistPersona(root, answers);
    const contents = await readFile(join(root, "ARTIST.md"), "utf8");

    expect(result.mode).toBe("replace_marker");
    expect(contents).toContain("Before stays.");
    expect(contents).toContain("Spotify section stays.");
    expect(contents).toContain("Artist name: Neon Relay");
    expect(contents).not.toContain("old block");
  });

  it("inserts a managed block after the heading for non-default ARTIST.md without markers", async () => {
    const root = makeRoot();
    await writeFile(join(root, "ARTIST.md"), "# ARTIST.md\n\nCustom hand-written section.\n", "utf8");

    const result = await writeArtistPersona(root, answers);
    const contents = await readFile(join(root, "ARTIST.md"), "utf8");

    expect(result.mode).toBe("append_marker");
    expect(contents).toMatch(/^# ARTIST\.md\n\n<!-- artist-runtime:persona:core:start -->/);
    expect(contents).toContain("Custom hand-written section.");
  });

  it("writes the completion marker without touching song or ledger state", async () => {
    const root = makeRoot();
    await mkdir(join(root, "runtime"), { recursive: true });

    const path = await writePersonaCompletionMarker(root, new Date("2026-04-27T00:00:00.000Z"));
    const marker = JSON.parse(await readFile(path, "utf8")) as { completedAt: string; source: string; version: number };

    expect(marker).toEqual({ completedAt: "2026-04-27T00:00:00.000Z", source: "telegram", version: 1 });
  });
});
