import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PersonaField } from "../types.js";
import { artistPersonaBlockEnd, artistPersonaBlockStart, readArtistPersonaSummary } from "./personaFileBuilder.js";
import { readPersonaSetupStatus } from "./personaSetupDetector.js";
import { readSoulPersonaSummary, soulPersonaBlockEnd, soulPersonaBlockStart } from "./soulFileBuilder.js";

export type PersonaFieldStatus = "filled" | "thin" | "missing";

export interface PersonaFieldAudit {
  field: PersonaField;
  status: PersonaFieldStatus;
  reason?: string;
  current?: string;
}

export interface PersonaAuditIssue {
  code:
    | "language_policy_outside_artist"
    | "duplicated_language_policy"
    | "conflicting_language_policy"
    | "duplicate_suno_profile"
    | "obsolete_lyrics_length_rule";
  file: string;
  detail: string;
}

export interface PersonaAuditReport {
  artistFile: { exists: boolean; markerPresent: boolean; externalImport: boolean };
  soulFile: { exists: boolean; markerPresent: boolean };
  fields: PersonaFieldAudit[];
  issues: PersonaAuditIssue[];
  customSections: string[];
  summary: { filled: number; thin: number; missing: number };
}

const standardArtistSections = new Set([
  "Public Identity",
  "Producer Relationship",
  "Current Artist Core",
  "Sound",
  "Lyrics",
  "Social Voice",
  "Suno Production Profile"
]);
const standardSoulSections = new Set(["Telegram Persona Voice"]);
const placeholderPattern = /^(?:tbd|unknown artist|\(not set\)|n\/a|none|-+)?$/i;
const minFilledLength = 20;

function artistPath(root: string): string {
  return join(root, "ARTIST.md");
}

function soulPath(root: string): string {
  return join(root, "SOUL.md");
}

function truncateCurrent(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function auditField(field: PersonaField, value: string): PersonaFieldAudit {
  const current = truncateCurrent(value);
  if (!current) {
    return { field, status: "missing", reason: "empty_or_absent" };
  }
  if (placeholderPattern.test(current)) {
    return { field, status: "thin", reason: "default_placeholder", current };
  }
  if (current.length < minFilledLength) {
    return { field, status: "thin", reason: "shorter_than_20_chars", current };
  }
  return { field, status: "filled", current };
}

function headings(contents: string): string[] {
  return [...contents.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1].trim());
}

function customSectionsFor(contents: string, standard: Set<string>): string[] {
  return headings(contents).filter((heading) => !standard.has(heading));
}

function countSummary(fields: PersonaFieldAudit[]): PersonaAuditReport["summary"] {
  return fields.reduce(
    (summary, field) => ({ ...summary, [field.status]: summary[field.status] + 1 }),
    { filled: 0, thin: 0, missing: 0 }
  );
}

function languagePolicies(file: string, contents: string): Array<{ file: string; value: string }> {
  return [...contents.matchAll(/日本語\s*(\d{1,3})\s*%\s*\/\s*英語\s*(\d{1,3})\s*%/g)].map((match) => ({
    file,
    value: `日本語${match[1]}%/英語${match[2]}%`
  }));
}

function countHeading(contents: string, heading: string): number {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...contents.matchAll(new RegExp(`^##\\s+${escaped}\\s*$`, "gm"))].length;
}

function auditPersonaIssues(files: Record<string, string>): PersonaAuditIssue[] {
  const issues: PersonaAuditIssue[] = [];
  const policies = Object.entries(files).flatMap(([file, contents]) => languagePolicies(file, contents));
  const uniquePolicies = [...new Set(policies.map((policy) => policy.value))];
  for (const policy of policies.filter((item) => item.file !== "ARTIST.md")) {
    issues.push({
      code: "language_policy_outside_artist",
      file: policy.file,
      detail: `${policy.value} belongs in ARTIST.md`
    });
  }
  if (policies.length > 1) {
    issues.push({
      code: uniquePolicies.length > 1 ? "conflicting_language_policy" : "duplicated_language_policy",
      file: "persona",
      detail: uniquePolicies.join(" / ")
    });
  }
  if (countHeading(files["ARTIST.md"] ?? "", "Suno Production Profile") > 1) {
    issues.push({
      code: "duplicate_suno_profile",
      file: "ARTIST.md",
      detail: "Suno Production Profile appears more than once"
    });
  }
  if (/文字数\s*[:：]\s*\d{3,5}\s*-\s*\d{3,5}\s*字/.test(files["ARTIST.md"] ?? "")) {
    issues.push({
      code: "obsolete_lyrics_length_rule",
      file: "ARTIST.md",
      detail: "fixed lyric character targets conflict with runtime DurationPlan and lyrics-box budget"
    });
  }
  return issues;
}

export async function auditPersonaCompleteness(root: string): Promise<PersonaAuditReport> {
  const [artistContents, soulContents, identityContents, producerContents, innerContents, socialVoiceContents, artistSummary, soulSummary, setupStatus] = await Promise.all([
    readFile(artistPath(root), "utf8").catch(() => ""),
    readFile(soulPath(root), "utf8").catch(() => ""),
    readFile(join(root, "IDENTITY.md"), "utf8").catch(() => ""),
    readFile(join(root, "PRODUCER.md"), "utf8").catch(() => ""),
    readFile(join(root, "INNER.md"), "utf8").catch(() => ""),
    readFile(join(root, "artist", "SOCIAL_VOICE.md"), "utf8").catch(() => ""),
    readArtistPersonaSummary(root),
    readSoulPersonaSummary(root),
    readPersonaSetupStatus(root)
  ]);
  const artistMarkerPresent = artistContents.includes(artistPersonaBlockStart) && artistContents.includes(artistPersonaBlockEnd);
  const soulMarkerPresent = soulContents.includes(soulPersonaBlockStart) && soulContents.includes(soulPersonaBlockEnd);
  const fields: PersonaFieldAudit[] = [
    auditField("artistName", artistSummary.artistName),
    auditField("identityLine", artistSummary.identityLine),
    auditField("soundDna", artistSummary.soundDna),
    auditField("obsessions", artistSummary.obsessions),
    auditField("lyricsRules", artistSummary.lyricsRules),
    auditField("socialVoice", artistSummary.socialVoice),
    auditField("soul-tone", soulSummary.conversationTone),
    auditField("soul-refusal", soulSummary.refusalStyle)
  ];
  const customSections = [
    ...customSectionsFor(artistContents, standardArtistSections),
    ...customSectionsFor(soulContents, standardSoulSections)
  ];
  const issues = auditPersonaIssues({
    "ARTIST.md": artistContents,
    "SOUL.md": soulContents,
    "IDENTITY.md": identityContents,
    "PRODUCER.md": producerContents,
    "INNER.md": innerContents,
    "artist/SOCIAL_VOICE.md": socialVoiceContents
  });

  return {
    artistFile: {
      exists: Boolean(artistContents.trim()),
      markerPresent: artistMarkerPresent,
      externalImport: setupStatus.completed && !setupStatus.marker
    },
    soulFile: { exists: Boolean(soulContents.trim()), markerPresent: soulMarkerPresent },
    fields,
    issues,
    customSections: [...new Set(customSections)],
    summary: countSummary(fields)
  };
}

export function formatPersonaAuditReport(report: PersonaAuditReport): string {
  const lines = [
    "Persona audit:",
    `ARTIST.md: ${report.artistFile.exists ? "present" : "missing"} / marker=${report.artistFile.markerPresent ? "yes" : "no"} / externalImport=${report.artistFile.externalImport ? "yes" : "no"}`,
    `SOUL.md: ${report.soulFile.exists ? "present" : "missing"} / marker=${report.soulFile.markerPresent ? "yes" : "no"}`,
    `Summary: ${report.summary.filled} filled, ${report.summary.thin} thin, ${report.summary.missing} missing`,
    "",
    "Fields:",
    ...report.fields.map((field) =>
      [
        `- ${field.field}: ${field.status}`,
        field.reason ? ` (${field.reason})` : "",
        field.current ? ` - ${field.current}` : ""
      ].join("")
    )
  ];
  if (report.customSections.length > 0) {
    lines.push("", `Custom sections: ${report.customSections.join(", ")}`);
  }
  if (report.issues.length > 0) {
    lines.push("", "Issues:", ...report.issues.map((issue) => `- ${issue.code}: ${issue.file} - ${issue.detail}`));
  }
  return lines.join("\n");
}
