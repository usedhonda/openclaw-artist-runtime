import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";

const realTemplateRoot = fileURLToPath(new URL("../workspace-template/", import.meta.url));

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

describe("ensureArtistWorkspace AGENTS.md template", () => {
  it("ships standing orders as a regular AGENTS.md file and copies it into new workspaces", async () => {
    const templateAgentsPath = join(realTemplateRoot, "AGENTS.md");
    expect(lstatSync(templateAgentsPath).isFile()).toBe(true);
    expect(readFileSync(templateAgentsPath, "utf8")).toContain("Producer conversation comes first");
    const root = tempWorkspace();

    const result = await ensureArtistWorkspace(root);

    const agentsPath = join(root, "AGENTS.md");
    const agents = await readFile(agentsPath, "utf8");
    expect(agents).toBe(await readFile(templateAgentsPath, "utf8"));
    expect(agents).toContain("Producer conversation comes first");
    expect(agents).toContain("execute the unambiguous portion");
    expect(agents).toContain("Do not blanket-block a mixed request");
    expect(agents).toContain("same lyrics, faster");
    expect(agents).toContain("artist_song_production_revise");
    expect(agents).toContain("historical run/take");
    expect(agents).toContain("Persist subject, request, keep-set, and decision");
    expect(result.created).toContain("AGENTS.md");
    expect(result.created).not.toContain("CLAUDE.md");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).not.toContain("@AGENTS.md");
  });

  it("does not overwrite an existing AGENTS.md", async () => {
    const root = tempWorkspace();
    writeFileSync(join(root, "AGENTS.md"), "PRESERVE ME", "utf8");

    const result = await ensureArtistWorkspace(root);

    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("PRESERVE ME");
    expect(result.created).not.toContain("AGENTS.md");
  });
});
