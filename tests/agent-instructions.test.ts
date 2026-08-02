import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");

/** Codex merges AGENTS.md files until project_doc_max_bytes (32 KiB default). */
const CODEX_DOC_BUDGET_BYTES = 32 * 1024;
/** Room reserved so a large global AGENTS.md cannot starve this contract. */
const PROJECT_CONTRACT_MAX_BYTES = 16 * 1024;

const read = (p: string) => readFileSync(join(repoRoot, p), "utf8");

describe("agent instruction system", () => {
  it("bridges AGENTS.md into Claude Code via the @import on the first line", () => {
    const firstLine = read("CLAUDE.md").split("\n")[0].trim();
    expect(firstLine).toBe("@AGENTS.md");
  });

  it("keeps the project contract inside the Codex document budget", () => {
    const bytes = statSync(join(repoRoot, "AGENTS.md")).size;
    expect(bytes).toBeLessThanOrEqual(PROJECT_CONTRACT_MAX_BYTES);
    expect(bytes).toBeLessThanOrEqual(CODEX_DOC_BUDGET_BYTES);
  });

  it("only references files that exist", () => {
    const missing: string[] = [];
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      const body = read(file);
      const refs = body.matchAll(/[`(]([A-Za-z0-9_./-]+\.(?:md|json|ts|mjs|sh))[`)]/g);
      for (const [, ref] of refs) {
        if (ref.startsWith("http")) continue;
        if (!ref.includes("/") && !ref.endsWith(".md")) continue;
        if (!existsSync(join(repoRoot, ref))) missing.push(`${file} -> ${ref}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("only references npm scripts that exist", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const referenced = [...read("AGENTS.md").matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]);
    const unknown = referenced.filter((s) => !(s in pkg.scripts));
    expect(unknown).toEqual([]);
  });

  it("never leaves a directory rule visible to only one tool", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    const oneSided: string[] = [];
    for (const path of tracked) {
      const base = path.split("/").pop();
      if (base !== "AGENTS.md" && base !== "CLAUDE.md") continue;
      const dir = dirname(path);
      const sibling = base === "AGENTS.md" ? "CLAUDE.md" : "AGENTS.md";
      if (!existsSync(join(repoRoot, dir, sibling))) oneSided.push(`${path} has no ${sibling}`);
    }
    expect(oneSided).toEqual([]);
  });
});
