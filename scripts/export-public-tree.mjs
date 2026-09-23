#!/usr/bin/env node
// Export the public tree of this repository into a directory.
//
//   node scripts/export-public-tree.mjs <target-dir>
//
// The public repository is published from a fresh tree, never from this
// repository's history. This script produces that tree mechanically so the
// exclusions cannot drift from what the commit guard allows:
//
//   1. `git archive HEAD` into the target (tracked files only);
//   2. remove PRIVATE_ONLY_PATHS (operator records), keeping the handoff template
//      as the public ACTIVE.md;
//   3. scan every exported file with both leak layers and fail on any finding.
//
// It never pushes. Publishing stays a separate, explicit step:
//   OPENCLAW_PUBLIC_PUSH=1 git push (from the exported repository).
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PRIVATE_ONLY_PATHS, resolveLeakPatterns, scanMaintainerLeaks } from "./maintainer-leak-scan.mjs";

function listFiles(root, dir = root) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, abs));
    else out.push(relative(root, abs));
  }
  return out;
}

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/export-public-tree.mjs <target-dir>");
  process.exit(2);
}
const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const outDir = resolve(target);
if (existsSync(outDir) && readdirSync(outDir).length > 0) {
  console.error(`export-public-tree: ${outDir} is not empty; refusing to overwrite`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

execSync(`git archive HEAD | tar -x -C "${outDir}"`, { cwd: repoRoot, stdio: "inherit" });

for (const path of PRIVATE_ONLY_PATHS) {
  rmSync(join(outDir, path), { recursive: true, force: true });
}
const template = join(outDir, "docs/handoff/TEMPLATE.md");
if (existsSync(template)) copyFileSync(template, join(outDir, "docs/handoff/ACTIVE.md"));

const files = listFiles(outDir);
const { patterns, privateSource, privateCount } = resolveLeakPatterns({ cwd: repoRoot });
// The exported tree has no private-only paths left, so no path-level allowance
// applies to it: every file is judged by the full rule set.
const findings = scanMaintainerLeaks({ cwd: outDir, files, patterns, skipPrivateOnly: false });
if (findings.length > 0) {
  for (const finding of findings) console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`);
  console.error(`export-public-tree: ${findings.length} leak(s) in the exported tree; do not publish it`);
  process.exit(1);
}
const layer = privateSource ? `generic + ${privateCount} private rule(s)` : "generic only (no private rule list found)";
console.log(`export-public-tree: ${files.length} files exported to ${outDir}, clean (${layer})`);
