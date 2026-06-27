import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanMaintainerLeaks } from "../scripts/maintainer-leak-scan.mjs";

async function writeFixture(root: string, relativePath: string, contents: string): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
}

describe("maintainer-leak-scan", () => {
  it("flags maintainer-specific identity in distributed files", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-maintainer-leak-hit-"));
    await writeFixture(root, "docs/leak.md", "the default used::honda profile\n");
    await writeFixture(root, "NOTICE.md", "copied from /Users/usedhonda/projects/docs/sunomanual\n");
    await writeFixture(root, "docs/runbook.md", "confirm artist account @used00honda\n");

    const findings = scanMaintainerLeaks({
      cwd: root,
      files: ["docs/leak.md", "NOTICE.md", "docs/runbook.md"]
    });

    expect(findings.map((f) => f.rule).sort()).toEqual(
      ["maintainer-artist-id", "maintainer-home-path", "maintainer-x-handle"].sort()
    );
  });

  it("does not flag the legitimate publisher id or NOTICE copyright attribution", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-maintainer-leak-clean-"));
    await writeFixture(root, "package.json", '{ "name": "@yzhonda/openclaw-artist-runtime", "author": "yzhonda" }\n');
    await writeFixture(root, "NOTICE.md", "Copyright (c) 2025-2026 usedhonda. Licensed CC BY-NC 4.0.\n");
    await writeFixture(root, "README.md", "openclaw plugins install clawhub:@yzhonda/openclaw-artist-runtime\n");

    const findings = scanMaintainerLeaks({
      cwd: root,
      files: ["package.json", "NOTICE.md", "README.md"]
    });

    expect(findings).toEqual([]);
  });

  it("flags the maintainer iTunes id, Firefox profile, and Telegram bot handle", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-maintainer-leak-ids-"));
    await writeFixture(
      root,
      "docs/ids.md",
      ["iTunes artist id 1889924232", "bird --firefox-profile rlff0kyr.artist-x", "bot @usedhonda_bot"].join("\n")
    );

    const findings = scanMaintainerLeaks({ cwd: root, files: ["docs/ids.md"] });

    expect(findings.map((f) => f.rule).sort()).toEqual(
      ["maintainer-firefox-profile", "maintainer-itunes-id", "maintainer-telegram-bot"].sort()
    );
  });

  it("ignores non-text files", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-maintainer-leak-binary-"));
    await writeFixture(root, "assets/used00honda.png", "used::honda binary-ish blob\n");

    const findings = scanMaintainerLeaks({ cwd: root, files: ["assets/used00honda.png"] });

    expect(findings).toEqual([]);
  });
});
