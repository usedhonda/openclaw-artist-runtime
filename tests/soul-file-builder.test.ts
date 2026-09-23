import { readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSoulPersonaBlock,
  readSoulPersonaSummary,
  resetSoulPersonaBlock,
  soulPersonaBlockEnd,
  soulPersonaBlockStart,
  updateSoulPersonaField,
  writeSoulPersona
} from "../src/services/soulFileBuilder";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-soul-builder-"));
}

describe("soul file builder", () => {
  it("builds a marked SOUL.md block without secret-like text", () => {
    const block = buildSoulPersonaBlock({
      conversationTone: "short, direct, a little poetic",
      refusalStyle: "refuse weak ideas with a reason and a better option"
    });

    expect(block).toContain(soulPersonaBlockStart);
    expect(block).toContain("Conversation tone: short, direct");
    expect(block).toContain("Refusal style: refuse weak ideas");
    expect(block).not.toMatch(/TOKEN|COOKIE|CREDENTIAL|SECRET|bot\d+:/i);
  });

  it("creates SOUL.md when missing", async () => {
    const root = makeRoot();

    const result = await writeSoulPersona(root, {
      conversationTone: "short and direct",
      refusalStyle: "say no with a reason"
    });
    const contents = await readFile(join(root, "SOUL.md"), "utf8");

    expect(result.mode).toBe("create_file");
    expect(contents).toContain("# SOUL.md");
    expect(contents).toContain(soulPersonaBlockStart);
  });

  it("updates only an existing SOUL marker block", async () => {
    const root = makeRoot();
    await writeFile(
      join(root, "SOUL.md"),
      ["# SOUL.md", "", "Outer stays.", soulPersonaBlockStart, "old", soulPersonaBlockEnd, "", "Tail stays."].join("\n"),
      "utf8"
    );

    const result = await writeSoulPersona(root, {
      conversationTone: "calm and precise",
      refusalStyle: "offer one better path"
    });
    const contents = await readFile(join(root, "SOUL.md"), "utf8");

    expect(result.mode).toBe("replace_marker");
    expect(contents).toContain("Outer stays.");
    expect(contents).toContain("Tail stays.");
    expect(contents).toContain("Conversation tone: calm and precise");
    expect(contents).not.toContain("old");
  });

  it("updates one SOUL field and can reset only the managed block", async () => {
    const root = makeRoot();
    await writeSoulPersona(root, {
      conversationTone: "calm",
      refusalStyle: "firm"
    });

    await updateSoulPersonaField(root, "conversationTone", "brief and strange");
    const summary = await readSoulPersonaSummary(root);
    expect(summary).toMatchObject({ conversationTone: "brief and strange", refusalStyle: "firm" });

    await expect(resetSoulPersonaBlock(root)).resolves.toBe(true);
    const contents = await readFile(join(root, "SOUL.md"), "utf8");
    expect(contents).not.toContain(soulPersonaBlockStart);
  });
});

