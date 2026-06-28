import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { personaCanonicalField, personaCanonicalOwnerCount } from "../src/services/personaCanonical";
import { auditPersonaCompleteness, formatPersonaAuditReport } from "../src/services/personaFieldAuditor";

const templateRoot = join(__dirname, "..", "workspace-template");
const personaTemplateFiles = ["ARTIST.md", "SOUL.md", "IDENTITY.md", "INNER.md", "PRODUCER.md"] as const;

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-persona-audit-"));
}

async function writeFixture(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "ARTIST.md"),
    [
      "# ARTIST.md",
      "",
      "## Public Identity",
      "",
      "Artist name: Obsidian Artist",
      "",
      "A nocturnal producer-avatar that writes from stations, platform ads, and weathered signals.",
      "",
      "## Current Artist Core",
      "",
      "- Core obsessions:",
      "  - neon",
      "- Emotional weather:",
      "  - controlled",
      "",
      "## Sound",
      "",
      "- Cold synth folk, close vocal, tape hiss, field-recorded station ambience.",
      "",
      "## Lyrics",
      "",
      "- Avoid cheap hope, direct imitation, and generic slogans.",
      "",
      "## Suno Production Profile",
      "",
      "```yaml",
      "name: Obsidian Artist",
      "```",
      "",
      "## Voice",
      "",
      "- This custom voice section must stay outside the managed marker.",
      "",
      "## Listener",
      "",
      "- People who like quiet static and late trains."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "SOUL.md"),
    [
      "# SOUL.md",
      "",
      "## Conversational Core",
      "",
      "Keep answers short and rough-edged.",
      "",
      "## Ritual",
      "",
      "Custom soul section."
    ].join("\n"),
    "utf8"
  );
}

describe("persona field auditor", () => {
  it("keeps factual identity owned by runtime config only", () => {
    expect(personaCanonicalOwnerCount("artistDisplayName")).toBe(1);
    expect(personaCanonicalOwnerCount("producerCallname")).toBe(1);
    expect(personaCanonicalField("artistDisplayName").owner).toEqual({
      kind: "config",
      path: "artist.identity.displayName"
    });
    expect(personaCanonicalField("producerCallname").owner).toEqual({
      kind: "config",
      path: "artist.identity.producerCallname"
    });
    expect(personaCanonicalField("artistDisplayName").forbiddenFiles).toContain("ARTIST.md");
    expect(personaCanonicalField("producerCallname").forbiddenFiles).toContain("SOUL.md");
  });

  it("keeps the workspace template free of persona responsibility overlap", async () => {
    const report = await auditPersonaCompleteness(templateRoot);

    expect(report.issues.filter((issue) => issue.code === "persona_responsibility_overlap")).toEqual([]);
  });

  it("keeps role definitions centralized in README instead of the five persona files", () => {
    for (const file of personaTemplateFiles) {
      const contents = readFileSync(join(templateRoot, file), "utf8").toLowerCase();
      expect(contents).not.toContain("canonical role split");
      expect(contents).not.toContain("this file follows the canonical role split");
      expect(contents).not.toContain("it owns");
      expect(contents).not.toContain("do not duplicate");
      expect(contents).not.toContain("chi");
      expect(contents).not.toContain("cc");
      expect(contents).not.toContain("plan v");
      expect(contents).not.toContain("御大");
      expect(contents).not.toContain("ゆずるさん");
    }
  });

  it("detects filled, thin, missing, external import, and custom sections", async () => {
    const root = makeRoot();
    await writeFixture(root);

    const report = await auditPersonaCompleteness(root);
    const byField = new Map(report.fields.map((field) => [field.field, field]));

    expect(report.artistFile).toEqual({ exists: true, markerPresent: false, externalImport: true });
    expect(report.soulFile).toEqual({ exists: true, markerPresent: false });
    expect(byField.get("artistName")?.status).toBe("filled");
    expect(byField.get("producerCallname")?.status).toBe("missing");
    expect(byField.get("soundDna")?.status).toBe("filled");
    expect(byField.get("obsessions")?.status).toBe("thin");
    expect(byField.get("socialVoice")?.status).toBe("missing");
    expect(byField.get("soul-tone")?.status).toBe("missing");
    expect(byField.get("soul-refusal")?.status).toBe("missing");
    expect(report.customSections).toEqual(expect.arrayContaining(["Voice", "Listener", "Conversational Core", "Ritual"]));
    expect(report.summary).toMatchObject({ filled: 4, thin: 1, missing: 4 });
  });

  it("formats a compact operator-facing audit report", async () => {
    const root = makeRoot();
    await writeFixture(root);

    const text = formatPersonaAuditReport(await auditPersonaCompleteness(root));

    expect(text).toContain("Persona audit:");
    expect(text).toContain("externalImport=yes");
    expect(text).toContain("- socialVoice: missing");
    expect(text).toContain("Custom sections: Voice, Listener");
    expect(text).not.toContain("artistName: thin");
    expect(text.length).toBeLessThan(1400);
  });

  it("flags duplicate and conflicting persona control directives", async () => {
    const root = makeRoot();
    await mkdir(join(root, "artist"), { recursive: true });
    await writeFile(
      join(root, "ARTIST.md"),
      [
        "# ARTIST.md",
        "",
        "<!-- artist-runtime:persona:core:start -->",
        "## Public Identity",
        "Artist name: used::honda",
        "",
        "## Producer Relationship",
        "The human is my producer.",
        "",
        "## Current Artist Core",
        "- Core obsessions:",
        "  - 社会風刺",
        "- Emotional weather:",
        "  - focused",
        "",
        "## Sound",
        "- nu-jazz rap",
        "",
        "## Lyrics",
        "- 言語比率: 日本語80% / 英語20%",
        "- 文字数: 1500-2000字。生成後に文字数を数える",
        "",
        "## Social Voice",
        "- short",
        "",
        "## Suno Production Profile",
        "```yaml",
        "name: used::honda",
        "```",
        "",
        "## Suno Production Profile",
        "```yaml",
        "language: ja",
        "```",
        "<!-- artist-runtime:persona:core:end -->"
      ].join("\n"),
      "utf8"
    );
    await writeFile(join(root, "SOUL.md"), "# SOUL.md\n\n## Internal Tensions\n- 日本語 70% / 英語 30%。\n", "utf8");
    await writeFile(join(root, "IDENTITY.md"), "- **Language:** 日本語 70% / 英語 30%\n", "utf8");
    await writeFile(join(root, "PRODUCER.md"), "", "utf8");
    await writeFile(join(root, "INNER.md"), "", "utf8");
    await writeFile(join(root, "artist", "SOCIAL_VOICE.md"), "", "utf8");

    const report = await auditPersonaCompleteness(root);
    const codes = report.issues.map((issue) => issue.code);

    expect(codes).toContain("language_policy_outside_artist");
    expect(codes).toContain("conflicting_language_policy");
    expect(codes).toContain("duplicate_suno_profile");
    expect(codes).toContain("obsolete_lyrics_length_rule");
    expect(codes).toContain("persona_responsibility_overlap");
    expect(formatPersonaAuditReport(report)).toContain("Issues:");
  });
});
