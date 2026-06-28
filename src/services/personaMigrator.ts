import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AiReviewProvider, PersonaField } from "../types.js";
import { createDebugAiReviewer } from "./debugAiReviewService.js";
import { backupPathIfPresentOnce } from "./personaBackup.js";
import { auditPersonaCompleteness } from "./personaFieldAuditor.js";
import {
  artistPersonaBlockEnd,
  artistPersonaBlockStart,
  buildArtistPersonaBlock,
  readArtistPersonaSummary,
  writePersonaCompletionMarker
} from "./personaFileBuilder.js";
import { buildSoulPersonaBlock, readSoulPersonaSummary, soulPersonaBlockEnd, soulPersonaBlockStart } from "./soulFileBuilder.js";
import { patchResolvedConfig, readResolvedConfig } from "./runtimeConfig.js";
import { parseVoiceFingerprint } from "./voiceFingerprintParser.js";
import { artistManagedSections, soulManagedSections } from "./personaCanonical.js";

export interface PersonaMigratePlan {
  artistBackupPath: string;
  soulBackupPath: string;
  artistMarkerInsertion: { existingSections: string[]; markerSections: string[] };
  soulMarkerInsertion: { existingSections: string[]; markerSections: string[] };
  operatorIntent?: string;
  aiProvider?: AiReviewProvider | "not_configured";
  proposedDrafts: PersonaMigrateDraft[];
  warnings: string[];
}

export interface PersonaMigrateOptions {
  intent?: string;
  aiReviewProvider?: AiReviewProvider;
}

export interface PersonaMigrateDraft {
  field: PersonaField;
  status: "proposed" | "skipped";
  value?: string;
  reason?: string;
}

export interface ParsedIntentDirective {
  field: PersonaField;
  value: string;
  skip: boolean;
}

interface MarkdownSection {
  level: number;
  heading: string;
  block: string;
}

const artistMarkerSections: string[] = [...artistManagedSections];
const soulMarkerSections: string[] = [...soulManagedSections];
export const secretLikePattern = /\bbot\d+:[A-Za-z0-9_-]{30,}\b|(?:^|\W)(?:TELEGRAM_BOT_TOKEN|API[_ -]?KEY|TOKEN|COOKIE|CREDENTIAL|PASSWORD|SECRET)\s*[:=]\s*[A-Za-z0-9+/=_-]{8,}/i;

function artistPath(root: string): string {
  return join(root, "ARTIST.md");
}

function soulPath(root: string): string {
  return join(root, "SOUL.md");
}

function utcStamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function uniqueBackupPath(path: string): Promise<string> {
  const base = `${path}.backup-${utcStamp()}`;
  if (!(await exists(base))) {
    return base;
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}.${index}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error("persona_backup_path_exhausted");
}

function parseSections(contents: string): MarkdownSection[] {
  const matches = [...contents.matchAll(/^(#{2,3})\s+(.+?)\s*$/gm)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? contents.length;
    return { level: match[1].length, heading: match[2].trim(), block: contents.slice(start, end).trim() };
  });
}

function h2Sections(contents: string): string[] {
  return parseSections(contents).filter((section) => section.level === 2).map((section) => section.heading);
}

function customBlocks(contents: string, markerSections: string[]): string[] {
  const marker = new Set(markerSections);
  return parseSections(contents)
    .filter((section) => !marker.has(section.heading))
    .map((section) => section.block)
    .filter(Boolean);
}

function withHeading(title: string, markerBlock: string, custom: string[]): string {
  return [`# ${title}`, "", markerBlock, ...custom.flatMap((block) => ["", block]), ""].join("\n");
}

function migrationValues(value: string, fallback = "TBD"): string {
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function proposedDraftValue(drafts: PersonaMigrateDraft[], field: PersonaField): string | undefined {
  const value = drafts.find((draft) => draft.field === field && draft.status === "proposed")?.value?.trim();
  return value || undefined;
}

function configuredIdentityValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "TBD" && trimmed !== "Unknown artist" && trimmed !== "Unnamed OpenClaw Artist" ? trimmed : undefined;
}

async function syncMigratedIdentityConfig(root: string): Promise<void> {
  const [artistSummary, soulContents] = await Promise.all([
    readArtistPersonaSummary(root),
    readFile(soulPath(root), "utf8").catch(() => "")
  ]);
  const displayName = configuredIdentityValue(artistSummary.artistName);
  const producerCallname = configuredIdentityValue(parseVoiceFingerprint(soulContents).producerCallname ?? undefined);
  if (!displayName && !producerCallname) {
    return;
  }
  const current = await readResolvedConfig(root);
  await patchResolvedConfig(root, {
    artist: {
      ...current.artist,
      identity: {
        ...current.artist.identity,
        ...(displayName ? { displayName } : {}),
        ...(producerCallname ? { producerCallname } : {})
      }
    }
  });
}

async function buildMigratedArtist(root: string, drafts: PersonaMigrateDraft[] = []): Promise<string> {
  const contents = await readFile(artistPath(root), "utf8").catch(() => "");
  const summary = await readArtistPersonaSummary(root);
  const markerBlock = buildArtistPersonaBlock({
    artistName: migrationValues(proposedDraftValue(drafts, "artistName") ?? summary.artistName, "TBD"),
    identityLine: migrationValues(proposedDraftValue(drafts, "identityLine") ?? summary.identityLine, "TBD"),
    soundDna: migrationValues(proposedDraftValue(drafts, "soundDna") ?? summary.soundDna, "TBD"),
    obsessions: migrationValues(proposedDraftValue(drafts, "obsessions") ?? summary.obsessions, "TBD"),
    lyricsRules: migrationValues(proposedDraftValue(drafts, "lyricsRules") ?? summary.lyricsRules, "TBD"),
    socialVoice: migrationValues(proposedDraftValue(drafts, "socialVoice") ?? summary.socialVoice, "TBD")
  });
  return withHeading("ARTIST.md", markerBlock, customBlocks(contents, artistMarkerSections));
}

async function buildMigratedSoul(root: string, drafts: PersonaMigrateDraft[] = []): Promise<string> {
  const contents = await readFile(soulPath(root), "utf8").catch(() => "");
  const summary = await readSoulPersonaSummary(root);
  const markerBlock = buildSoulPersonaBlock({
    conversationTone: migrationValues(proposedDraftValue(drafts, "soul-tone") ?? summary.conversationTone, "TBD"),
    refusalStyle: migrationValues(proposedDraftValue(drafts, "soul-refusal") ?? summary.refusalStyle, "TBD")
  });
  const hasStandardSoulSection = h2Sections(contents).some((heading) => soulMarkerSections.includes(heading));
  if (contents.trim() && !hasStandardSoulSection) {
    return [contents.trimEnd(), "", markerBlock, ""].join("\n");
  }
  return withHeading("SOUL.md", markerBlock, customBlocks(contents, soulMarkerSections));
}

function normalizeIntent(intent?: string): string | undefined {
  const normalized = intent?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

const personaFields: PersonaField[] = [
  "artistName",
  "identityLine",
  "soundDna",
  "obsessions",
  "lyricsRules",
  "socialVoice",
  "soul-tone",
  "soul-refusal"
];

function fieldAliases(field: PersonaField): string[] {
  switch (field) {
    case "artistName":
      return ["artistName", "artist name", "name"];
    case "identityLine":
      return ["identityLine", "identity", "manifesto"];
    case "soundDna":
      return ["soundDna", "sound"];
    case "obsessions":
      return ["obsessions", "themes", "theme"];
    case "lyricsRules":
      return ["lyricsRules", "lyrics", "lyrics rule"];
    case "socialVoice":
      return ["socialVoice", "social voice", "voice"];
    case "soul-tone":
      return ["soul-tone", "soul tone", "conversation tone", "tone"];
    case "soul-refusal":
      return ["soul-refusal", "soul refusal", "refusal style", "refusal"];
  }
}

function normalizeDirectiveKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function buildDirectiveAliasMap(): Map<string, PersonaField> {
  const aliases = new Map<string, PersonaField>();
  for (const field of personaFields) {
    for (const alias of fieldAliases(field)) {
      aliases.set(normalizeDirectiveKey(alias), field);
    }
  }
  return aliases;
}

function detectSkipDirective(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase();
  return firstToken === "keep" || /\b(skip|keep as-is|keep as is)\b/i.test(trimmed);
}

export function parseIntentDirectives(intent: string): Map<PersonaField, ParsedIntentDirective> {
  const directives = new Map<PersonaField, ParsedIntentDirective>();
  const aliasMap = buildDirectiveAliasMap();
  let currentField: PersonaField | undefined;

  for (const rawLine of intent.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([a-zA-Z][\w\s-]*?)\s*:\s*(.*)$/);
    const matchedField = match ? aliasMap.get(normalizeDirectiveKey(match[1])) : undefined;
    if (matchedField) {
      const value = match?.[2] ?? "";
      directives.set(matchedField, { field: matchedField, value, skip: detectSkipDirective(value) });
      currentField = matchedField;
      continue;
    }
    if (!currentField) {
      continue;
    }
    const directive = directives.get(currentField);
    if (!directive) {
      continue;
    }
    const nextValue = directive.value ? `${directive.value}\n${rawLine}` : rawLine;
    directives.set(currentField, { ...directive, value: nextValue, skip: detectSkipDirective(nextValue) });
  }

  for (const [field, directive] of directives.entries()) {
    const value = directive.value.trim();
    directives.set(field, { ...directive, value, skip: detectSkipDirective(value) });
  }

  return directives;
}

function isSkippedByIntent(intent: string, field: PersonaField): boolean {
  return parseIntentDirectives(intent).get(field)?.skip === true;
}

async function proposeDrafts(
  root: string,
  options: PersonaMigrateOptions,
  warnings: string[]
): Promise<{ provider?: AiReviewProvider | "not_configured"; drafts: PersonaMigrateDraft[] }> {
  const intent = normalizeIntent(options.intent);
  if (!intent) {
    return { drafts: [] };
  }
  if (secretLikePattern.test(intent)) {
    warnings.push("operator intent contains secret-like text; draft generation skipped");
    return { drafts: [] };
  }
  const report = await auditPersonaCompleteness(root);
  const candidates = report.fields.filter((field) => field.status === "missing" || field.status === "thin");
  if (candidates.length === 0) {
    return { provider: options.aiReviewProvider ?? "mock", drafts: [] };
  }

  const reviewer = createDebugAiReviewer(options.aiReviewProvider);
  const providerResult = await reviewer.review({
    songId: "persona-migrate",
    title: "Persona migrate intent drafts",
    brief: [
      `Operator intent: ${intent}`,
      report.customSections.length > 0 ? `Custom sections: ${report.customSections.join(", ")}` : undefined
    ].filter(Boolean).join("\n"),
    takes: []
  });
  const provider = providerResult.provider;
  if (provider !== "mock") {
    warnings.push(`AI provider ${provider} is not configured for persona migrate drafts; placeholders will be used`);
    return { provider, drafts: [] };
  }

  const parsed = parseIntentDirectives(options.intent ?? "");
  const drafts = candidates.map((field): PersonaMigrateDraft => {
    const directive = parsed.get(field.field);
    if (directive?.skip || (!directive && isSkippedByIntent(options.intent ?? "", field.field))) {
      return { field: field.field, status: "skipped", reason: "skip per operator intent" };
    }
    if (directive && directive.value.trim().length > 0) {
      return {
        field: field.field,
        status: "proposed",
        value: directive.value.trim(),
        reason: field.status === "missing" ? "missing field" : "thin field"
      };
    }
    return {
      field: field.field,
      status: "proposed",
      value: "",
      reason: "could not extract from intent; provide explicit field directive"
    };
  });
  return { provider, drafts };
}

export async function planPersonaMigrate(root: string, options: PersonaMigrateOptions = {}): Promise<PersonaMigratePlan> {
  const [artistContents, soulContents] = await Promise.all([
    readFile(artistPath(root), "utf8").catch(() => ""),
    readFile(soulPath(root), "utf8").catch(() => "")
  ]);
  const artistAlreadyMigrated = artistContents.includes(artistPersonaBlockStart) && artistContents.includes(artistPersonaBlockEnd);
  const soulAlreadyMigrated = soulContents.includes(soulPersonaBlockStart) && soulContents.includes(soulPersonaBlockEnd);
  const warnings: string[] = [];
  if (artistAlreadyMigrated && soulAlreadyMigrated) {
    warnings.push("already migrated");
  }
  if (!artistContents.trim()) {
    warnings.push("ARTIST.md missing or empty; migrator will create a placeholder managed block");
  }
  if (!soulContents.trim()) {
    warnings.push("SOUL.md missing or empty; migrator will create a placeholder managed block");
  }
  const operatorIntent = normalizeIntent(options.intent);
  const proposed = artistAlreadyMigrated && soulAlreadyMigrated
    ? { provider: options.aiReviewProvider ?? "mock", drafts: [] }
    : await proposeDrafts(root, options, warnings);
  return {
    artistBackupPath: await uniqueBackupPath(artistPath(root)),
    soulBackupPath: await uniqueBackupPath(soulPath(root)),
    artistMarkerInsertion: {
      existingSections: h2Sections(artistContents),
      markerSections: artistMarkerSections
    },
    soulMarkerInsertion: {
      existingSections: h2Sections(soulContents),
      markerSections: soulMarkerSections
    },
    operatorIntent,
    aiProvider: proposed.provider,
    proposedDrafts: proposed.drafts,
    warnings
  };
}

export async function executePersonaMigrate(root: string, plan: PersonaMigratePlan): Promise<void> {
  if (plan.warnings.includes("already migrated")) {
    await syncMigratedIdentityConfig(root);
    return;
  }
  const [artist, soul] = await Promise.all([buildMigratedArtist(root, plan.proposedDrafts), buildMigratedSoul(root, plan.proposedDrafts)]);
  await Promise.all([
    backupPathIfPresentOnce(artistPath(root), plan.artistBackupPath, `migrate:${plan.artistBackupPath}`),
    backupPathIfPresentOnce(soulPath(root), plan.soulBackupPath, `migrate:${plan.soulBackupPath}`)
  ]);
  await Promise.all([
    mkdir(dirname(artistPath(root)), { recursive: true }),
    mkdir(dirname(soulPath(root)), { recursive: true })
  ]);
  await Promise.all([
    writeFile(artistPath(root), artist.endsWith("\n") ? artist : `${artist}\n`, "utf8"),
    writeFile(soulPath(root), soul.endsWith("\n") ? soul : `${soul}\n`, "utf8")
  ]);
  await writePersonaCompletionMarker(root);
  await syncMigratedIdentityConfig(root);
}

export function formatPersonaMigratePlan(plan: PersonaMigratePlan): string {
  const draftLines = plan.proposedDrafts.length > 0
    ? [
        `Proposed drafts (AI provider=${plan.aiProvider ?? "mock"}):`,
        ...plan.proposedDrafts.map((draft) =>
          draft.status === "skipped"
            ? `- ${draft.field}: skip per operator intent`
            : `- ${draft.field}: ${draft.value?.trim() ? draft.value : "(no value extracted; provide directive in next /persona migrate)"}`
        )
      ]
    : [`Proposed drafts (AI provider=${plan.aiProvider ?? "mock"}): none`];
  return [
    "Persona migrate plan:",
    plan.operatorIntent ? `Operator intent: ${plan.operatorIntent}` : undefined,
    `ARTIST backup: ${plan.artistBackupPath}`,
    `SOUL backup: ${plan.soulBackupPath}`,
    `ARTIST marker sections: ${plan.artistMarkerInsertion.markerSections.join(", ")}`,
    `ARTIST existing sections: ${plan.artistMarkerInsertion.existingSections.join(", ") || "(none)"}`,
    `SOUL marker sections: ${plan.soulMarkerInsertion.markerSections.join(", ")}`,
    `SOUL existing sections: ${plan.soulMarkerInsertion.existingSections.join(", ") || "(none)"}`,
    "",
    ...draftLines,
    plan.warnings.length > 0 ? `Warnings: ${plan.warnings.join("; ")}` : "Warnings: none",
    "",
    "Reply /confirm migrate to write marker blocks, or /cancel."
  ].filter((line): line is string => line !== undefined).join("\n");
}
