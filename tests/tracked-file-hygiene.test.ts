import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { machineSpecificPathPatterns, scanMaintainerLeaks } from "../scripts/maintainer-leak-scan.mjs";

// Local vs Distribution layout contract guard (see AGENTS.md).
//
// Tracked repo files must stay public-safe: no machine-specific absolute paths
// (a `/Users/<name>/...` or `/home/<name>/...` home directory). Values unique to
// one machine belong in the gitignored `.local/` overlay
// (`.local/openclaw-local-env.local.sh`), not in a tracked file. This guard runs
// as part of `npm test` so a leak fails CI mechanically instead of riding along
// as a permanently-dirty tracked edit.
//
// Reuses the shared scan engine + pattern source from maintainer-leak-scan.mjs
// (which checks the distribution surface); this guard checks the whole tracked
// surface (`git ls-files`). Bare repo-relative `.local/` references are allowed;
// only absolute machine paths are flagged.
//
// Every allowlist entry needs a reason. If you are here because a NEW file
// tripped this guard: move the machine-specific value into the `.local/` overlay
// and reference it via an env seed, do not allowlist a fresh source/script/doc.
const ALLOWLIST: Record<string, string> = {
  // Fixtures that intentionally embed the maintainer home path to exercise the
  // distribution leak scanner itself.
  "tests/maintainer-leak-scan.test.ts": "leak-scan fixtures embed a sample home path on purpose",
  // Env-stub fixture uses a deliberately fake operator home path as test data.
  "tests/config-field-meta.test.ts": "fake operator home path used as env-stub test data",
  // This guard embeds synthetic home-path strings as pattern self-check fixtures.
  "tests/tracked-file-hygiene.test.ts": "synthetic home-path fixtures for the pattern self-check below",
  // Loop-skill working notes that quote the leak-scan patterns as documentation;
  // not a distributed, executed, or runtime surface.
  ".loop/distribution-readiness.done.json": "loop readiness note quoting leak-scan patterns",
  ".loop/distribution-readiness.md": "loop readiness note quoting leak-scan patterns"
};

function trackedFiles(cwd: string): string[] {
  return execSync("git ls-files", { cwd, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

describe("tracked-file hygiene (local vs distribution contract)", () => {
  const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

  it("has no machine-specific absolute paths in tracked files", () => {
    const files = trackedFiles(repoRoot);
    const findings = scanMaintainerLeaks({
      cwd: repoRoot,
      files,
      patterns: machineSpecificPathPatterns
    }).filter((finding) => !(finding.file in ALLOWLIST));

    expect(
      findings,
      findings.length > 0
        ? `Machine-specific absolute path(s) leaked into tracked files. Move the value to ` +
            `.local/openclaw-local-env.local.sh (or another .local overlay) and reference it via ` +
            `an env seed:\n${findings.map((f) => `  ${f.file}:${f.line} [${f.rule}] ${f.text}`).join("\n")}`
        : undefined
    ).toEqual([]);
  });

  it("flags a synthetic machine-specific home path", () => {
    const macos = machineSpecificPathPatterns.some((rule) => rule.pattern.test("cd /Users/someone/projects/app"));
    const linux = machineSpecificPathPatterns.some((rule) => rule.pattern.test("cd /home/someone/projects/app"));
    expect(macos).toBe(true);
    expect(linux).toBe(true);
  });
});
