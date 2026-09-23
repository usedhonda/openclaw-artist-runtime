import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIVATE_LEAK_PATTERN_FILE,
  genericLeakPatterns,
  loadPrivateLeakPatterns,
  resolveLeakPatterns,
  scanMaintainerLeaks
} from "../scripts/maintainer-leak-scan.mjs";

async function writeFixture(root: string, relativePath: string, contents: string): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
}

describe("maintainer-leak-scan generic layer", () => {
  it("flags operator-specific shapes that any deployment can leak", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-leak-generic-"));
    await writeFixture(root, "docs/paths.md", "state lives in /Users/someone/projects/runtime\n");
    await writeFixture(root, "docs/linux.md", "and in /home/otheroperator/.openclaw\n");
    await writeFixture(root, "docs/contact.md", "mail the producer at producer@artistmail.co\n");
    await writeFixture(root, "docs/net.md", "console at http://100.64.0.9:43134/\n");
    await writeFixture(root, "docs/token.md", "TELEGRAM_BOT_TOKEN=1234567890:AAqrstuvwxyzabcdefghijklmnopQRSTUVW\n");

    const findings = scanMaintainerLeaks({
      cwd: root,
      files: ["docs/paths.md", "docs/linux.md", "docs/contact.md", "docs/net.md", "docs/token.md"]
    });

    expect(findings.map((f) => f.rule).sort()).toEqual(
      [
        "generic-bot-token",
        "generic-home-linux",
        "generic-home-macos",
        "generic-mail-address",
        "generic-tailnet-address"
      ].sort()
    );
  });

  it("keeps this deployment's identity out of the tracked scanner", () => {
    const repoRoot = join(__dirname, "..");
    const { patterns: privatePatterns } = loadPrivateLeakPatterns({ cwd: repoRoot, env: {} });
    const trackedSource = readFileSync(join(repoRoot, "scripts/maintainer-leak-scan.mjs"), "utf8");

    for (const rule of privatePatterns) {
      expect(trackedSource).not.toContain(rule.pattern.source);
    }
    expect(genericLeakPatterns.every((rule) => rule.id.startsWith("generic-"))).toBe(true);
  });

  it("does not flag a package scope, an attribution line, or an install command", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-leak-clean-"));
    await writeFixture(root, "package.json", '{ "name": "@scope/openclaw-artist-runtime", "author": "scope" }\n');
    await writeFixture(root, "NOTICE.md", "Copyright (c) 2025-2026 the maintainers. Licensed MIT.\n");
    await writeFixture(root, "README.md", "openclaw plugins install clawhub:@scope/openclaw-artist-runtime\n");

    const findings = scanMaintainerLeaks({ cwd: root, files: ["package.json", "NOTICE.md", "README.md"] });

    expect(findings).toEqual([]);
  });

  it("ignores non-text files", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-leak-binary-"));
    await writeFixture(root, "assets/cover.png", "/Users/someone/blob\n");

    const findings = scanMaintainerLeaks({ cwd: root, files: ["assets/cover.png"] });

    expect(findings).toEqual([]);
  });
});

describe("maintainer-leak-scan private identity layer", () => {
  it("scans with the generic layer alone when a checkout has no private list", () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-leak-nolist-"));

    const resolved = resolveLeakPatterns({ cwd: root, env: {} });

    expect(resolved.privateSource).toBeNull();
    expect(resolved.privateCount).toBe(0);
    expect(resolved.patterns).toEqual(genericLeakPatterns);
  });

  it("loads a deployment's own identity rules from the gitignored file", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-leak-private-"));
    await writeFixture(
      root,
      PRIVATE_LEAK_PATTERN_FILE,
      JSON.stringify({ patterns: [{ id: "operator-handle", pattern: "@?example-handle", flags: "i" }] })
    );
    await writeFixture(root, "docs/runbook.md", "confirm the account @Example-Handle before posting\n");

    const { patterns } = resolveLeakPatterns({ cwd: root, env: {} });
    const findings = scanMaintainerLeaks({ cwd: root, files: ["docs/runbook.md"], patterns });

    expect(findings.map((f) => f.rule)).toEqual(["operator-handle"]);
  });

  it("reads the list named by OPENCLAW_LEAK_PATTERNS_FILE instead of the default path", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-leak-env-"));
    await writeFixture(root, "private/rules.json", JSON.stringify([{ id: "operator-id", pattern: "secret::id" }]));

    const { patterns, privateSource, privateCount } = resolveLeakPatterns({
      cwd: root,
      env: { OPENCLAW_LEAK_PATTERNS_FILE: "private/rules.json" }
    });

    expect(privateCount).toBe(1);
    expect(privateSource).toBe(join(root, "private/rules.json"));
    expect(patterns.at(-1)?.id).toBe("operator-id");
  });

  it("refuses a malformed private entry instead of scanning with a silent gap", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-leak-bad-"));
    await writeFixture(root, PRIVATE_LEAK_PATTERN_FILE, JSON.stringify({ patterns: [{ id: "no-pattern" }] }));

    expect(() => loadPrivateLeakPatterns({ cwd: root, env: {} })).toThrow(/has no "pattern"/);
  });
});
