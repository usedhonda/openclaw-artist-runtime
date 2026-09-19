import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");

/** Codex merges AGENTS.md files until project_doc_max_bytes (32 KiB default). */
const CODEX_DOC_BUDGET_BYTES = 32 * 1024;
/** Room reserved so a large global AGENTS.md cannot starve this contract. */
const PROJECT_CONTRACT_MAX_BYTES = 16 * 1024;

const read = (p: string) => readFileSync(join(repoRoot, p), "utf8");

describe("agent instruction system", () => {
  it("uses root AGENTS.md without a root CLAUDE.md adapter", () => {
    expect(existsSync(join(repoRoot, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(repoRoot, "CLAUDE.md"))).toBe(false);
  });

  it("keeps the project contract inside the Codex document budget", () => {
    const bytes = statSync(join(repoRoot, "AGENTS.md")).size;
    expect(bytes).toBeLessThanOrEqual(PROJECT_CONTRACT_MAX_BYTES);
    expect(bytes).toBeLessThanOrEqual(CODEX_DOC_BUDGET_BYTES);
  });

  it("only references files that exist", () => {
    const missing: string[] = [];
    const body = read("AGENTS.md");
    const refs = body.matchAll(/[`(]([A-Za-z0-9_./-]+\.(?:md|json|ts|mjs|sh))[`)]/g);
    for (const [, ref] of refs) {
      if (ref.startsWith("http")) continue;
      if (!ref.includes("/") && !ref.endsWith(".md")) continue;
      if (!existsSync(join(repoRoot, ref))) missing.push(`AGENTS.md -> ${ref}`);
    }
    expect(missing).toEqual([]);
  });

  it("only references npm scripts that exist", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const referenced = [...read("AGENTS.md").matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]);
    const unknown = referenced.filter((s) => !(s in pkg.scripts));
    expect(unknown).toEqual([]);
  });

  it("tracks AGENTS.md files as regular files and no CLAUDE.md instruction files", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const invalid: string[] = [];
    for (const path of tracked) {
      if (!existsSync(join(repoRoot, path))) continue;
      if (path.endsWith("/CLAUDE.md") || path === "CLAUDE.md") invalid.push(`${path} is tracked`);
      if (!path.endsWith("AGENTS.md")) continue;
      if (!lstatSync(join(repoRoot, path)).isFile()) invalid.push(`${path} is not a regular file`);
    }
    expect(invalid).toEqual([]);
  });
});
