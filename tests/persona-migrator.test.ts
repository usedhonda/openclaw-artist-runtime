import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artistPersonaBlockStart } from "../src/services/personaFileBuilder";
import { executePersonaMigrate, planPersonaMigrate } from "../src/services/personaMigrator";
import { soulPersonaBlockStart } from "../src/services/soulFileBuilder";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-persona-migrate-"));
}

async function writeObsidianLikePersona(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "ARTIST.md"),
    [
      "# ARTIST.md",
      "",
      "## Public Identity",
      "",
      "Artist name: Obsidian Artist",
      "",
      "A public artist with a detailed imported manifesto.",
      "",
      "### 人物像",
      "",
      "Imported custom sub-section that must survive outside the marker.",
      "",
      "## Sound",
      "",
      "- Broken station folk, close vocal, static percussion.",
      "",
      "## Lyrics",
      "",
      "- Avoid glossy slogan language.",
      "",
      "## Suno Production Profile",
      "",
      "```yaml",
      "name: Obsidian Artist",
      "```",
      "",
      "## Voice",
      "",
      "- Custom voice section.",
      "",
      "## Listener",
      "",
      "- Custom listener section."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "SOUL.md"),
    ["# SOUL.md", "", "## Conversational Core", "", "Short and direct.", "", "## Ritual", "", "Keep one strange edge."].join("\n"),
    "utf8"
  );
}

describe("persona migrator", () => {
  it("plans and migrates non-marker persona files while preserving custom sections outside markers", async () => {
    const root = makeRoot();
    await writeObsidianLikePersona(root);

    const plan = await planPersonaMigrate(root);
    expect(plan.artistMarkerInsertion.existingSections).toEqual(
      expect.arrayContaining(["Public Identity", "Sound", "Lyrics", "Suno Production Profile", "Voice", "Listener"])
    );
    expect(plan.artistMarkerInsertion.markerSections).toContain("Social Voice");
    expect(plan.artistBackupPath).toContain("ARTIST.md.backup-");

    await executePersonaMigrate(root, plan);
    const artist = await readFile(join(root, "ARTIST.md"), "utf8");
    const soul = await readFile(join(root, "SOUL.md"), "utf8");

    await expect(stat(plan.artistBackupPath)).resolves.toBeTruthy();
    await expect(stat(plan.soulBackupPath)).resolves.toBeTruthy();
    expect(artist).toContain(artistPersonaBlockStart);
    expect(artist).toContain("Artist name: Obsidian Artist");
    expect(artist).toContain("Social Voice");
    expect(artist).toContain("TBD");
    expect(artist).toContain("## Voice");
    expect(artist).toContain("## Listener");
    expect(artist).toContain("### 人物像");
    expect(artist.lastIndexOf("## Voice")).toBeGreaterThan(artist.indexOf("<!-- artist-runtime:persona:core:end -->"));
    expect(soul).toContain(soulPersonaBlockStart);
    expect(soul).toContain("Conversation tone: TBD");
    expect(soul).toContain("## Conversational Core");
    await expect(readFile(join(root, "runtime", "persona-completed.json"), "utf8")).resolves.toContain("telegram");
  });

  it("preserves custom SOUL content without standard Telegram Persona Voice sections", async () => {
    const root = makeRoot();
    await writeObsidianLikePersona(root);
    const customSoul = [
      "<!--",
      "このファイルについて: OpenClaw標準: SOUL.md",
      "役割: 会話人格・応答の温度感を定義する。",
      "-->",
      "",
      "# SOUL.md",
      "",
      "You speak as the artist, not as a generic assistant.",
      "",
      "You are concise, observant, and artistically opinionated."
    ].join("\n");
    await writeFile(join(root, "SOUL.md"), customSoul, "utf8");

    const plan = await planPersonaMigrate(root);
    await executePersonaMigrate(root, plan);
    const soul = await readFile(join(root, "SOUL.md"), "utf8");

    expect(soul).toContain("このファイルについて: OpenClaw標準: SOUL.md");
    expect(soul).toContain("You speak as the artist, not as a generic assistant.");
    expect(soul).toContain(soulPersonaBlockStart);
    expect(soul.indexOf("You speak as the artist")).toBeLessThan(soul.indexOf(soulPersonaBlockStart));
    expect(soul.length).toBeGreaterThan(customSoul.length);
  });

  it("returns early for already migrated files", async () => {
    const root = makeRoot();
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "ARTIST.md"),
      ["# ARTIST.md", "", "<!-- artist-runtime:persona:core:start -->", "managed", "<!-- artist-runtime:persona:core:end -->"].join("\n"),
      "utf8"
    );
    await writeFile(
      join(root, "SOUL.md"),
      ["# SOUL.md", "", "<!-- artist-runtime:persona:soul:start -->", "managed", "<!-- artist-runtime:persona:soul:end -->"].join("\n"),
      "utf8"
    );
    const before = await readFile(join(root, "ARTIST.md"), "utf8");

    const plan = await planPersonaMigrate(root);
    await executePersonaMigrate(root, plan);

    expect(plan.warnings).toContain("already migrated");
    await expect(readFile(join(root, "ARTIST.md"), "utf8")).resolves.toBe(before);
    await expect(stat(plan.artistBackupPath)).rejects.toThrow();
  });
});
