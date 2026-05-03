import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proposeTheme } from "../src/services/themeProposer";

async function workspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-theme-proposer-"));
  await mkdir(join(root, "artist"), { recursive: true });
  await writeFile(join(root, "ARTIST.md"), "Artist name: used::honda\n## Current Artist Core\n- satire", "utf8");
  await writeFile(join(root, "SOUL.md"), "Conversation tone: direct", "utf8");
  await writeFile(join(root, "artist", "CURRENT_STATE.md"), "## Current Obsessions\n- public noise", "utf8");
  await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "short and sharp", "utf8");
  return root;
}

describe("theme proposer", () => {
  it("returns a motif-anchored mock theme", async () => {
    const root = await workspace();
    const proposal = await proposeTheme(root, { observations: "- people arguing under neon" });

    expect(proposal.provider).toBe("mock");
    expect(proposal.motifSummary).toContain("satire");
    expect(proposal.theme).toContain("satire");
    expect(proposal.reason).toContain("motif anchor");
  });

  it("rejects secret-like context", async () => {
    const root = await workspace();

    await expect(proposeTheme(root, { observations: "PASSWORD=do-not-store" })).rejects.toThrow("secret");
  });
});
