import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideCreative } from "../src/services/creativeDirector";
import { diagnosePersonaContract } from "../src/services/personaContractDoctor";

// The two shipped persona templates (`templates/ARTIST.md`, the doc-facing
// minimal example, and `workspace-template/ARTIST.md`, what a fresh install
// actually bootstraps into the operator's workspace) must both pass every
// persona-contract-doctor check out of the box, and must be able to produce one
// real creative decision — otherwise a fresh install starts already degraded.
const repoRoot = join(__dirname, "..");

describe.each([
  ["templates/ARTIST.md", join(repoRoot, "templates", "ARTIST.md")],
  ["workspace-template/ARTIST.md", join(repoRoot, "workspace-template", "ARTIST.md")]
])("shipped persona template: %s", (_label, path) => {
  it("passes every persona contract doctor check", async () => {
    const personaText = await readFile(path, "utf8");
    const report = diagnosePersonaContract(personaText);
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("produces one creative decision with no built-in-fallback degradation", async () => {
    const personaText = await readFile(path, "utf8");
    const decision = decideCreative({
      songId: "song-template-check",
      jstDate: "2026-09-23",
      personaText,
      observation: null,
      recentDecisions: []
    });
    expect(decision.lens).not.toBe("");
    expect(decision.lensMaterial.length).toBeGreaterThan(0);
    expect(decision.tagTechnique).not.toBe("");
    expect(decision.attackStance).not.toBe("");
    expect(decision.signature.length).toBeGreaterThan(0);
    expect(decision.degradedInputs).toEqual(
      expect.not.arrayContaining([
        "lens_missing",
        "material_banks_empty",
        "tag_techniques_missing",
        "attack_stances_missing",
        "signature_missing",
        "catchphrases_missing"
      ])
    );
  });

  it("carries no city names, real people, or Shibuya-artist-specific vocabulary", async () => {
    const personaText = await readFile(path, "utf8");
    expect(personaText).not.toMatch(/shibuya|渋谷|六本木/i);
  });
});
