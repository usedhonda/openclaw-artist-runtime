import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), "scripts", "import-obsidian-artist.mjs");

const sourceArtist = `---
name: "obsidian::artist"
genres: ["ambient", "rap"]
language: "ja"
tempo_range: "90-130"
---

# obsidian::artist

## 人物像
Imported persona body.

## 声・歌い方
Imported voice body.

## 出力ルール（全曲共通）
- Imported refusal rule.
`;

function makeRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function makeSourceVault(): Promise<string> {
  const source = makeRoot("artist-runtime-obsidian-source-");
  await mkdir(join(source, "artists"), { recursive: true });
  await writeFile(join(source, "artists", "obsidian.md"), sourceArtist, "utf8");
  return source;
}

async function makeTargetWorkspace(): Promise<string> {
  const target = makeRoot("artist-runtime-obsidian-target-");
  await mkdir(join(target, "artist"), { recursive: true });
  await writeFile(
    join(target, "ARTIST.md"),
    [
      "# ARTIST.md",
      "",
      "<!-- artist-runtime:persona:core:start -->",
      "Telegram artist block stays.",
      "<!-- artist-runtime:persona:core:end -->",
      "",
      "Old imported body."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(target, "SOUL.md"),
    [
      "# SOUL.md",
      "",
      "<!-- artist-runtime:persona:soul:start -->",
      "Telegram soul block stays.",
      "<!-- artist-runtime:persona:soul:end -->",
      "",
      "Old soul body."
    ].join("\n"),
    "utf8"
  );
  return target;
}

describe("obsidian importer telegram persona preservation", () => {
  it("keeps Telegram-managed ARTIST and SOUL marker blocks by default", async () => {
    const source = await makeSourceVault();
    const target = await makeTargetWorkspace();

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--source",
      source,
      "--target",
      target,
      "--artist",
      "obsidian",
      "--force"
    ]);

    const artist = await readFile(join(target, "ARTIST.md"), "utf8");
    const soul = await readFile(join(target, "SOUL.md"), "utf8");
    expect(stdout).toContain("preserve: ARTIST.md telegram persona block kept");
    expect(stdout).toContain("preserve: SOUL.md telegram persona block kept");
    expect(artist).toContain("Telegram artist block stays.");
    expect(artist).toContain("Artist name: obsidian::artist");
    expect(soul).toContain("Telegram soul block stays.");
    expect(soul).toContain("Imported refusal rule.");
  });

  it("replaces imported files when preservation is explicitly disabled", async () => {
    const source = await makeSourceVault();
    const target = await makeTargetWorkspace();

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--source",
      source,
      "--target",
      target,
      "--artist",
      "obsidian",
      "--force",
      "--no-preserve-telegram-persona"
    ]);

    const artist = await readFile(join(target, "ARTIST.md"), "utf8");
    const soul = await readFile(join(target, "SOUL.md"), "utf8");
    expect(stdout).toContain("preserve: ARTIST.md telegram persona preservation disabled");
    expect(stdout).toContain("preserve: SOUL.md telegram persona preservation disabled");
    expect(artist).not.toContain("Telegram artist block stays.");
    expect(soul).not.toContain("Telegram soul block stays.");
    expect(artist).toContain("Artist name: obsidian::artist");
    expect(soul).toContain("Imported persona body.");
  });
});
