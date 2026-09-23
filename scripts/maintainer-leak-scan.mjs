#!/usr/bin/env node
// Distribution leak guard: fails if operator-specific identity appears in
// anything that ships in the published tarball or in the public source tree.
//
// Two layers, because this repository is meant to become a public package:
//
//   * The generic layer below is tracked. It carries no proper nouns, only
//     shapes that are operator-specific for ANY operator: home directories,
//     mail addresses, tailnet addresses and bot tokens.
//   * The identity layer is private. A deployment's own handles, persona ids,
//     browser-profile ids and catalog ids are exactly the thing this guard
//     exists to keep out of a public repository, so the list itself must not
//     live in one. It is read at runtime from `.local/leak-patterns.json`
//     (gitignored) or from the file named by OPENCLAW_LEAK_PATTERNS_FILE.
//
// A checkout without that private file still scans, using the generic layer
// only, and says so. That is the correct behaviour for a contributor who has no
// operator identity to protect.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const PRIVATE_LEAK_PATTERN_FILE = ".local/leak-patterns.json";

// Operator-specific by shape, for any operator. Public-safe: no proper nouns.
export const genericLeakPatterns = [
  { id: "generic-home-macos", pattern: /\/Users\/[A-Za-z0-9._-]+(?:\/|\b)/ },
  { id: "generic-home-linux", pattern: /\/home\/[A-Za-z0-9._-]+(?:\/|\b)/ },
  // Reserved documentation names (RFC 2606 / RFC 6761) are not identities, so
  // fixtures and docs can keep using them.
  {
    id: "generic-mail-address",
    pattern: /\b[A-Za-z0-9._%+-]+@(?!(?:[A-Za-z0-9.-]+\.)?example\.(?:com|net|org)\b)(?!(?:[A-Za-z0-9.-]+\.)?(?:test|example|invalid|localhost)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/
  },
  { id: "generic-tailnet-address", pattern: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/ },
  { id: "generic-bot-token", pattern: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/ }
];

// Reads the private identity layer. Returns an empty list when the deployment
// has none, so a public checkout is scannable without it.
export function loadPrivateLeakPatterns({ cwd = process.cwd(), env = process.env } = {}) {
  const configured = env.OPENCLAW_LEAK_PATTERNS_FILE?.trim();
  const path = configured ? (isAbsolute(configured) ? configured : join(cwd, configured)) : join(cwd, PRIVATE_LEAK_PATTERN_FILE);
  if (!existsSync(path)) {
    return { patterns: [], source: null };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const entries = Array.isArray(parsed) ? parsed : (parsed.patterns ?? []);
  const patterns = entries.map((entry, index) => {
    if (!entry?.pattern) {
      throw new Error(`${path}: entry ${index} has no "pattern"`);
    }
    return { id: entry.id ?? `private-${index}`, pattern: new RegExp(entry.pattern, entry.flags ?? "") };
  });
  return { patterns, source: path };
}

// The full rule set a scan should use: generic shapes plus this deployment's
// private identity layer, when one is present.
export function resolveLeakPatterns({ cwd = process.cwd(), env = process.env } = {}) {
  const { patterns, source } = loadPrivateLeakPatterns({ cwd, env });
  return { patterns: [...genericLeakPatterns, ...patterns], privateSource: source, privateCount: patterns.length };
}

// Machine-specific absolute paths, shared with the tracked-file hygiene guard
// (tests/tracked-file-hygiene.test.ts) so the two-layer "local vs distribution"
// contract has a single pattern source. A machine-specific ".local/..." leak is
// an absolute home path, so it is caught here too; bare repo-relative ".local/"
// references are intentionally not flagged.
export const machineSpecificPathPatterns = genericLeakPatterns.filter((rule) => rule.id.startsWith("generic-home-"));

const textExtensions = /\.(?:cjs|cts|html|js|json|jsx|md|mjs|mts|sh|ts|tsx|txt|ya?ml)$/i;

// Documented exceptions. Each one is public-safe by inspection: a third-party
// copyright line, or a network constant that only looks like an address. They
// are file- and rule-scoped so they cannot hide a real leak elsewhere.
// A `rule` of "*" allows every rule for that file; use it only for files whose
// whole purpose is to carry synthetic examples of what the guard looks for.
export const leakScanAllowances = [
  { rule: "generic-mail-address", file: "NOTICE.md", reason: "third-party copyright lines carry upstream authors' addresses" },
  { rule: "generic-tailnet-address", file: "src/services/ssrfGuard.ts", reason: "CGNAT range constant, not an operator address" },
  { rule: "generic-tailnet-address", file: "dist/services/ssrfGuard.js", reason: "compiled copy of the CGNAT range constant" },
  { rule: "*", file: "tests/maintainer-leak-scan.test.ts", reason: "fixtures are synthetic examples of every guarded shape" },
  { rule: "*", file: "tests/tracked-file-hygiene.test.ts", reason: "pattern self-check fixtures" },
  { rule: "*", file: "tests/config-field-meta.test.ts", reason: "fake operator home path used as env-stub test data" },
  { rule: "generic-tailnet-address", file: "tests/ssrf-guard.test.ts", reason: "CGNAT addresses are the inputs the SSRF guard must reject" },
  { rule: "generic-tailnet-address", file: "tests/scripts/openclaw-local-env.test.ts", reason: "synthetic CGNAT address for the tailnet URL derivation" },
  { rule: "generic-bot-token", file: "tests/secret-like-pattern-strictness.test.ts", reason: "dummy token the secret detector must catch" }
];

// Operator records that live only in the private repository. The public tree is
// exported without them (scripts/export-public-tree.mjs), so identity in them is
// expected and does not block a commit here. A trailing "/" means a directory.
export const PRIVATE_ONLY_PATHS = [
  "docs/handoff/ACTIVE.md",
  "docs/handoff/archive/",
  "docs/log/",
  "docs/voice-reference/"
];

export function isPrivateOnlyPath(file) {
  return PRIVATE_ONLY_PATHS.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path));
}

function isAllowed(rule, file, allowances, skipPrivateOnly) {
  if (skipPrivateOnly && isPrivateOnlyPath(file)) return true;
  return allowances.some((entry) => entry.file === file && (entry.rule === rule || entry.rule === "*"));
}

// Pure, testable: scans the given relative `files` under `cwd` for leak patterns.
// `patterns` defaults to the generic layer so a caller that passes no rules still
// catches operator-specific shapes; the hygiene guard passes
// machineSpecificPathPatterns and the CLI passes the resolved two-layer set.
export function scanMaintainerLeaks({
  cwd = process.cwd(),
  files = [],
  patterns = genericLeakPatterns,
  allowances = leakScanAllowances,
  skipPrivateOnly = true
} = {}) {
  const findings = [];
  for (const rel of files) {
    if (!textExtensions.test(rel)) {
      continue;
    }
    let contents;
    try {
      contents = readFileSync(join(cwd, rel), "utf8");
    } catch {
      continue;
    }
    const lines = contents.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const rule of patterns) {
        if (rule.pattern.test(line) && !isAllowed(rule.id, rel, allowances, skipPrivateOnly)) {
          findings.push({ rule: rule.id, file: rel, line: index + 1, text: line.trim().slice(0, 200) });
        }
      }
    }
  }
  return findings;
}

function walk(cwd, dir) {
  const root = join(cwd, dir);
  if (!existsSync(root)) {
    return [];
  }
  const out = [];
  for (const name of readdirSync(root)) {
    const abs = join(root, name);
    if (statSync(abs).isDirectory()) {
      out.push(...walk(cwd, relative(cwd, abs)));
    } else {
      out.push(relative(cwd, abs));
    }
  }
  return out;
}

// Impure: the distribution surface = published tarball files + public source.
export function listDistributedFiles(cwd = process.cwd()) {
  const pack = JSON.parse(execSync("npm pack --dry-run --json", { cwd, encoding: "utf8" }));
  const tarball = (pack[0]?.files ?? []).map((entry) => entry.path);
  const source = [...walk(cwd, "src"), ...walk(cwd, "ui/src")];
  return [...new Set([...tarball, ...source])];
}

// The staged surface, for the pre-commit layer: what is about to be committed.
export function listStagedFiles(cwd = process.cwd()) {
  return execSync("git diff --cached --name-only --diff-filter=ACMR", { cwd, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function main() {
  const cwd = process.cwd();
  const staged = process.argv.includes("--staged");
  const { patterns, privateSource, privateCount } = resolveLeakPatterns({ cwd });
  const files = staged ? listStagedFiles(cwd) : listDistributedFiles(cwd);
  const findings = scanMaintainerLeaks({ cwd, files, patterns });

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`);
    }
    console.error(`maintainer-leak-scan: ${findings.length} leak(s) in ${staged ? "staged changes" : "distributed surface"}`);
    process.exitCode = 1;
    return;
  }

  const layer = privateSource
    ? `generic + ${privateCount} private rule(s) from ${relative(cwd, privateSource) || privateSource}`
    : `generic only (no ${PRIVATE_LEAK_PATTERN_FILE}; add one to guard this deployment's identity)`;
  console.log(`maintainer-leak-scan passed (${files.length} ${staged ? "staged" : "distributed"} files scanned, ${layer})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
