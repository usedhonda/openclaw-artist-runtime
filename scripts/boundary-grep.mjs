#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const forbiddenPatterns = [
  { id: "suno-password-assignment", pattern: /\bSUNO_PASSWORD\s*=/i },
  { id: "suno-api-key-assignment", pattern: /\bSUNO_API_KEY\s*=/i },
  { id: "instagram-password-assignment", pattern: /\bINSTAGRAM_PASSWORD\s*=/i },
  { id: "tiktok-token-assignment", pattern: /\bTIKTOK_ACCESS_TOKEN\s*=/i },
  { id: "openclaw-instagram-token-assignment", pattern: /\bOPENCLAW_INSTAGRAM_ACCESS_TOKEN\s*=/i },
  { id: "openclaw-tiktok-token-assignment", pattern: /\bOPENCLAW_TIKTOK_ACCESS_TOKEN\s*=/i },
  { id: "telegram-token-assignment", pattern: /\bTELEGRAM_BOT_TOKEN\s*=\s*\S+/i },
  { id: "telegram-token-literal", pattern: /\bbot[0-9]+:[A-Za-z0-9_-]{30,}/ },
  { id: "oauth-token-assignment", pattern: /\bOAUTH_TOKEN\s*=/i },
  { id: "oauth-token-literal", pattern: /\boauth_token_[A-Za-z0-9_-]+/i },
  { id: "bearer-header-literal", pattern: /\bauthorization\s*:\s*bearer\s+["'`]?[A-Za-z0-9._-]{12,}/i },
  { id: "cookie-header-literal", pattern: /\bcookie\s*:\s*["'`][^"'`]{8,}/i },
  { id: "sensitive-console-dump", pattern: /\bconsole\.(?:log|warn|error)\([^)]*(?:token|secret|password|cookie|authorization)(?:\s*[:=]|["'`]\s*,)/i },
  { id: "hardcoded-env-fallback", pattern: /process\.env\.[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|COOKIE)\s*\|\|\s*["'`][^"'`\s]+/ },
  { id: "absolute-env-path", pattern: /\/Users\/[^"'`\s]+\/[^"'`\s]*\.env(?:\.[^"'`\s]+)?/ },
  { id: "document-cookie-access", pattern: /\bdocument\.cookie\b/ },
  { id: "profile-cookie-copy", pattern: /openclaw-browser-profiles\/suno\/.*(?:cookie|session|token)/i },
  { id: "bash-mapfile", pattern: /^\s*mapfile\b/ },
  { id: "bash-readarray", pattern: /^\s*readarray\b/ },
  { id: "bash-uppercase-expansion", pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*\^\^\}/ },
  { id: "bash-lowercase-expansion", pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*,,\}/ },
  { id: "bash-associative-array", pattern: /^\s*declare\s+-A\b/ },
  { id: "bash-coproc", pattern: /^\s*coproc\b/ }
];

const defaultRoots = ["src", "tests", "scripts", ".github/workflows"];
const textExtensions = new Set([
  "",
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".sh",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml"
]);

const ignoredRelativePaths = new Set(["scripts/boundary-grep.mjs"]);

function extensionOf(path) {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

async function collectFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const entry = await stat(root);
  if (entry.isFile()) {
    return textExtensions.has(extensionOf(root)) ? [root] : [];
  }
  if (!entry.isDirectory()) {
    return [];
  }

  const files = [];
  const children = await readdir(root, { withFileTypes: true });
  for (const child of children) {
    if (child.name === "node_modules" || child.name === "dist" || child.name === "coverage" || child.name === ".git") {
      continue;
    }
    const path = join(root, child.name);
    if (ignoredRelativePaths.has(relative(process.cwd(), path))) {
      continue;
    }
    files.push(...await collectFiles(path));
  }
  return files;
}

const allowPragmaPattern = /boundary-grep-allow:\s*([A-Za-z0-9-]+)/g;

// Collect the rule ids explicitly allowed by `boundary-grep-allow: <rule-id>`
// pragmas on a single line. Only exact rule ids are honored; there is no
// wildcard or "allow all" form, so an exception can never widen past the one
// rule it names.
function allowedRuleIds(line) {
  const ids = new Set();
  if (!line) {
    return ids;
  }
  allowPragmaPattern.lastIndex = 0;
  let match;
  while ((match = allowPragmaPattern.exec(line)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

export async function scanBoundaryPatterns({ cwd = process.cwd(), roots = defaultRoots, allowed = [] } = {}) {
  const findings = [];
  const files = (await Promise.all(roots.map((root) => collectFiles(join(cwd, root))))).flat();

  for (const file of files) {
    if (ignoredRelativePaths.has(relative(cwd, file))) {
      continue;
    }
    const contents = await readFile(file, "utf8");
    const lines = contents.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const allowIdsCurrent = allowedRuleIds(line);
      const allowIdsPrevious = index > 0 ? allowedRuleIds(lines[index - 1]) : new Set();
      for (const rule of forbiddenPatterns) {
        if (rule.pattern.test(line)) {
          const entry = {
            rule: rule.id,
            file: relative(cwd, file),
            line: index + 1,
            text: line.trim()
          };
          if (allowIdsCurrent.has(rule.id) || allowIdsPrevious.has(rule.id)) {
            allowed.push(entry);
            continue;
          }
          findings.push(entry);
        }
      }
    }
  }

  return findings;
}

function parseArgs(argv) {
  const roots = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--root requires a path");
      }
      roots.push(next);
      index += 1;
    } else {
      roots.push(value);
    }
  }
  return roots.length > 0 ? roots : defaultRoots;
}

function reportAllowedExceptions(allowed) {
  console.log(`boundary-grep: ${allowed.length} allowed exception(s)`);
  for (const entry of allowed) {
    console.log(`  allowed ${entry.file}:${entry.line} [${entry.rule}]`);
  }
}

async function main() {
  const roots = parseArgs(process.argv.slice(2));
  const allowed = [];
  const findings = await scanBoundaryPatterns({ roots, allowed });

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`);
    }
    reportAllowedExceptions(allowed);
    process.exitCode = 1;
    return;
  }

  console.log(`boundary-grep passed (${roots.join(", ")})`);
  reportAllowedExceptions(allowed);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
