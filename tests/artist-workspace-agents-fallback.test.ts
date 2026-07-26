import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";

// The shipped template exposes AGENTS.md as a symlink to CLAUDE.md, but npm packs
// drop symlinks, so distributed installs bootstrap from a template with no
// AGENTS.md. ensureArtistWorkspace must regenerate AGENTS.md from CLAUDE.md so the
// artist workspace always has its Codex-facing standing orders.

const realTemplateRoot = fileURLToPath(new URL("../workspace-template/", import.meta.url));

// Build a distribution-equivalent copy of the template (symlink AGENTS.md removed).
function distributionTemplate(options: { dropClaude?: boolean } = {}): string {
  const templateRoot = mkdtempSync(join(tmpdir(), "artist-template-dist-"));
  cpSync(realTemplateRoot, templateRoot, { recursive: true });
  rmSync(join(templateRoot, "AGENTS.md"), { force: true });
  if (options.dropClaude) {
    rmSync(join(templateRoot, "CLAUDE.md"), { force: true });
  }
  return templateRoot;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const tempRoots: string[] = [];

function tempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "artist-workspace-agents-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ensureArtistWorkspace AGENTS.md fallback", () => {
  it("regenerates AGENTS.md from CLAUDE.md when the template omits it (distribution case)", async () => {
    const templateRoot = distributionTemplate();
    const root = tempWorkspace();

    const result = await ensureArtistWorkspace(root, templateRoot);

    const agentsPath = join(root, "AGENTS.md");
    expect(await exists(agentsPath)).toBe(true);
    const [agents, claude] = await Promise.all([
      readFile(agentsPath, "utf8"),
      readFile(join(root, "CLAUDE.md"), "utf8")
    ]);
    expect(agents).toBe(claude);
    expect(result.created).toContain("AGENTS.md");

    rmSync(templateRoot, { recursive: true, force: true });
  });

  it("does not overwrite an existing AGENTS.md", async () => {
    const templateRoot = distributionTemplate();
    const root = tempWorkspace();
    // Pre-seed a workspace AGENTS.md with sentinel content.
    writeFileSync(join(root, "AGENTS.md"), "PRESERVE ME", "utf8");

    const result = await ensureArtistWorkspace(root, templateRoot);

    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents).toBe("PRESERVE ME");
    expect(result.created).not.toContain("AGENTS.md");

    rmSync(templateRoot, { recursive: true, force: true });
  });

  it("does nothing when neither AGENTS.md nor CLAUDE.md is available", async () => {
    const templateRoot = distributionTemplate({ dropClaude: true });
    const root = tempWorkspace();

    const result = await ensureArtistWorkspace(root, templateRoot);

    expect(await exists(join(root, "AGENTS.md"))).toBe(false);
    expect(result.created).not.toContain("AGENTS.md");

    rmSync(templateRoot, { recursive: true, force: true });
  });
});
