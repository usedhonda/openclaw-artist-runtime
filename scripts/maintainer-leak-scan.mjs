#!/usr/bin/env node
// Distribution leak guard: fails if maintainer-specific identity (the original
// author's artist persona id, home path, personal social/Telegram handles,
// dedicated browser profile, or catalog id) appears in anything that ships in
// the published tarball or in the public source tree.
//
// Patterns are intentionally narrow so they do NOT flag the legitimate publisher
// id `yzhonda` (npm scope / repo owner / package author) or the `usedhonda`
// copyright attribution in NOTICE.md (which carries no `::`, home path, or
// account handle).
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const maintainerLeakPatterns = [
  { id: "maintainer-artist-id", pattern: /used::honda/i },
  { id: "maintainer-home-path", pattern: /\/Users\/usedhonda/i },
  { id: "maintainer-x-handle", pattern: /@?used00honda/i },
  { id: "maintainer-telegram-bot", pattern: /usedhonda_bot/i },
  { id: "maintainer-firefox-profile", pattern: /rlff0kyr/i },
  { id: "maintainer-itunes-id", pattern: /\b1889924232\b/ },
  { id: "maintainer-name-jp", pattern: /ゆずる/ }
];

const textExtensions = /\.(?:cjs|cts|html|js|json|jsx|md|mjs|mts|sh|ts|tsx|txt|ya?ml)$/i;

// Pure, testable: scans the given relative `files` under `cwd` for leak patterns.
export function scanMaintainerLeaks({ cwd = process.cwd(), files = [] } = {}) {
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
      for (const rule of maintainerLeakPatterns) {
        if (rule.pattern.test(line)) {
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

function main() {
  const cwd = process.cwd();
  const files = listDistributedFiles(cwd);
  const findings = scanMaintainerLeaks({ cwd, files });

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`);
    }
    console.error(`maintainer-leak-scan: ${findings.length} maintainer leak(s) in distributed surface`);
    process.exitCode = 1;
    return;
  }

  console.log(`maintainer-leak-scan passed (${files.length} distributed files scanned)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
