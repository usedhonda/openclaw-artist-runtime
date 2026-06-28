import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PersonaAnswers } from "../types.js";
import { artistManagedSections } from "./personaCanonical.js";

export const artistPersonaBlockStart = "<!-- artist-runtime:persona:core:start -->";
export const artistPersonaBlockEnd = "<!-- artist-runtime:persona:core:end -->";

const artistNameTbdPattern = /(^|\n)\s*Artist name:\s*TBD\s*(\n|$)/i;
const sunoNameTbdPattern = /(^|\n)\s*name:\s*TBD\s*(\n|$)/i;
const secretPattern = /(TELEGRAM_BOT_TOKEN|bot\d+:[A-Za-z0-9_-]{30,}|API[_ -]?KEY|COOKIE|CREDENTIAL|PASSWORD|SECRET)/i;
const defaultArtistPersonaFieldValues = {
  artistName: "Unnamed OpenClaw Artist",
  identityLine: "A public musical artist that turns observations into autonomous songs.",
  soundDna: "alternative pop, glassy synth texture, close controlled vocal",
  obsessions: "night infrastructure, private signals, lonely machines",
  lyricsRules: "avoid cheap hope, direct imitation, generic slogans, and corporate uplift",
  socialVoice: "short, observant, unsalesy, concrete"
};

export interface WriteArtistPersonaResult {
  path: string;
  mode: "replace_default" | "replace_marker" | "append_marker";
}

export interface ArtistPersonaSummary {
  artistName: string;
  identityLine: string;
  soundDna: string;
  obsessions: string;
  lyricsRules: string;
  socialVoice: string;
}

function artistPath(root: string): string {
  return join(root, "ARTIST.md");
}

function completionMarkerPath(root: string): string {
  return join(root, "runtime", "persona-completed.json");
}

function logPersonaFileSideEffectFailure(context: string, error: unknown): void {
  if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return;
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[persona-file-builder] ${context} failed: ${reason}`);
}

function splitCommaish(value: string): string[] {
  return value
    .split(/[,、\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildArtistPersonaBlock(pending: Partial<PersonaAnswers>): string {
  const answers = completeArtistPersonaAnswers(pending);
  const soundTraits = splitCommaish(answers.soundDna);
  const obsessions = splitCommaish(answers.obsessions);
  const lyricRules = splitCommaish(answers.lyricsRules);
  const socialRules = splitCommaish(answers.socialVoice);

  return [
    artistPersonaBlockStart,
    "## Public Identity",
    "",
    `Artist name: ${answers.artistName}`,
    "",
    answers.identityLine,
    "",
    "## Current Artist Core",
    "",
    "- Core obsessions:",
    ...obsessions.map((item) => `  - ${item}`),
    "- Emotional weather:",
    "  - focused",
    "  - observant",
    "  - self-directed",
    "",
    "## Sound",
    "",
    ...soundTraits.map((item) => `- ${item}`),
    "",
    "## Lyrics",
    "",
    ...lyricRules.map((item) => `- ${item}`),
    "",
    "## Social Voice",
    "",
    ...socialRules.map((item) => `- ${item}`),
    "",
    "## Suno Production Profile",
    "",
    "```yaml",
    `name: ${answers.artistName}`,
    "genres:",
    ...soundTraits.slice(0, 3).map((item) => `  - ${item}`),
    "language: operator-defined",
    "source_channels:",
    "  - public observations",
    "  - producer notes",
    "  - artist diary",
    "```",
    "",
    "### Output rules",
    "",
    "- Always produce Style, Exclude, YAML lyrics, sliders, and payload for Suno.",
    "- Avoid direct artist-name prompting.",
    "- Describe sonic features instead of copying named artists.",
    artistPersonaBlockEnd
  ].join("\n");
}

export function completeArtistPersonaAnswers(pending: Partial<PersonaAnswers>): Required<Pick<
  PersonaAnswers,
  "artistName" | "identityLine" | "soundDna" | "obsessions" | "lyricsRules" | "socialVoice"
>> {
  return {
    artistName: String(pending.artistName ?? defaultArtistPersonaFieldValues.artistName),
    identityLine: String(pending.identityLine ?? defaultArtistPersonaFieldValues.identityLine),
    soundDna: String(pending.soundDna ?? defaultArtistPersonaFieldValues.soundDna),
    obsessions: String(pending.obsessions ?? defaultArtistPersonaFieldValues.obsessions),
    lyricsRules: String(pending.lyricsRules ?? defaultArtistPersonaFieldValues.lyricsRules),
    socialVoice: String(pending.socialVoice ?? defaultArtistPersonaFieldValues.socialVoice)
  };
}

export function assertPersonaBlockSafe(block: string): void {
  if (secretPattern.test(block)) {
    throw new Error("persona_block_contains_secret_like_text");
  }
}

function isDefaultArtistTemplate(contents: string): boolean {
  return !contents.trim() || artistNameTbdPattern.test(contents) || sunoNameTbdPattern.test(contents);
}

function replaceMarkerBlock(contents: string, block: string): string {
  const expression = new RegExp(`${artistPersonaBlockStart}[\\s\\S]*?${artistPersonaBlockEnd}`);
  return contents.replace(expression, block);
}

export function extractManagedPersonaBlock(contents: string, startMarker: string, endMarker: string): string | undefined {
  const expression = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  return contents.match(expression)?.[0];
}

export function preserveManagedPersonaBlock(
  nextContents: string,
  existingContents: string,
  startMarker: string,
  endMarker: string
): { contents: string; preserved: boolean } {
  const existingBlock = extractManagedPersonaBlock(existingContents, startMarker, endMarker);
  if (!existingBlock) {
    return { contents: nextContents, preserved: false };
  }

  const nextExpression = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (nextExpression.test(nextContents)) {
    return { contents: nextContents.replace(nextExpression, existingBlock), preserved: true };
  }

  const titleExpression = /^#\s+.+$/m;
  if (titleExpression.test(nextContents)) {
    return {
      contents: nextContents.replace(titleExpression, (match) => `${match}\n\n${existingBlock}`),
      preserved: true
    };
  }

  return { contents: `${existingBlock}\n\n${nextContents.trimStart()}`, preserved: true };
}

function removeMarkerBlock(contents: string): string {
  const expression = new RegExp(`\\n?${artistPersonaBlockStart}[\\s\\S]*?${artistPersonaBlockEnd}\\n?`);
  return contents.replace(expression, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function extractMarkerBlock(contents: string): string {
  return extractManagedPersonaBlock(contents, artistPersonaBlockStart, artistPersonaBlockEnd) ?? contents;
}

function sectionBetween(contents: string, heading: string, nextHeading: string): string {
  const expression = new RegExp(`## ${heading}\\n\\n([\\s\\S]*?)(?=\\n## ${nextHeading}\\n|${artistPersonaBlockEnd}|$)`);
  return contents.match(expression)?.[1]?.trim() ?? "";
}

function sectionUntilNextManaged(contents: string, heading: string): string {
  const index = artistManagedSections.indexOf(heading as (typeof artistManagedSections)[number]);
  const nextHeading = index >= 0 ? artistManagedSections[index + 1] : undefined;
  const exact = nextHeading ? sectionBetween(contents, heading, nextHeading) : "";
  if (exact) {
    return exact;
  }
  const expression = new RegExp(`## ${heading}\\n\\n([\\s\\S]*?)(?=\\n##\\s+|${artistPersonaBlockEnd}|$)`);
  return contents.match(expression)?.[1]?.trim() ?? "";
}

function bulletsToText(contents: string): string {
  return contents
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
    .join(", ");
}

function insertAfterArtistHeading(contents: string, block: string): string {
  const heading = /^# ARTIST\.md\s*$/m;
  if (!heading.test(contents)) {
    return `${block}\n\n${contents.trimEnd()}\n`;
  }
  return contents.replace(heading, `# ARTIST.md\n\n${block}`);
}

export async function writeArtistPersona(root: string, pending: Partial<PersonaAnswers>): Promise<WriteArtistPersonaResult> {
  const path = artistPath(root);
  const existing = await readFile(path, "utf8").catch(() => "");
  const block = buildArtistPersonaBlock(pending);
  assertPersonaBlockSafe(block);

  let mode: WriteArtistPersonaResult["mode"];
  let nextContents: string;
  if (existing.includes(artistPersonaBlockStart) && existing.includes(artistPersonaBlockEnd)) {
    mode = "replace_marker";
    nextContents = replaceMarkerBlock(existing, block);
  } else if (isDefaultArtistTemplate(existing)) {
    mode = "replace_default";
    nextContents = `# ARTIST.md\n\n${block}\n`;
  } else {
    mode = "append_marker";
    nextContents = insertAfterArtistHeading(existing, block);
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, nextContents.endsWith("\n") ? nextContents : `${nextContents}\n`, "utf8");
  return { path, mode };
}

export async function readArtistPersonaSummary(root: string): Promise<ArtistPersonaSummary> {
  const contents = await readFile(artistPath(root), "utf8").catch(() => "");
  const block = extractMarkerBlock(contents);
  const publicIdentity = sectionUntilNextManaged(block, "Public Identity");
  const core = sectionUntilNextManaged(block, "Current Artist Core");
  const sound = sectionUntilNextManaged(block, "Sound");
  const lyrics = sectionUntilNextManaged(block, "Lyrics");
  const social = sectionUntilNextManaged(block, "Social Voice");
  return {
    artistName: publicIdentity.match(/Artist name:\s*(.+)/)?.[1]?.trim() || "Unknown artist",
    identityLine: publicIdentity
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("Artist name:"))[0] ?? "",
    soundDna: bulletsToText(sound),
    obsessions: bulletsToText(core.match(/- Core obsessions:([\s\S]*?)- Emotional weather:/)?.[1] ?? core),
    lyricsRules: bulletsToText(lyrics),
    socialVoice: bulletsToText(social)
  };
}

export async function updateArtistPersonaField(
  root: string,
  field: keyof ArtistPersonaSummary,
  value: string
): Promise<WriteArtistPersonaResult> {
  const current = await readArtistPersonaSummary(root);
  return writeArtistPersona(root, { ...current, [field]: value });
}

export async function resetArtistPersonaBlock(root: string): Promise<boolean> {
  const path = artistPath(root);
  const contents = await readFile(path, "utf8").catch(() => "");
  if (!contents.includes(artistPersonaBlockStart) || !contents.includes(artistPersonaBlockEnd)) {
    await unlink(completionMarkerPath(root)).catch((error) => logPersonaFileSideEffectFailure("completion marker cleanup", error));
    return false;
  }
  const nextContents = removeMarkerBlock(contents);
  await writeFile(path, nextContents ? `${nextContents}\n` : "", "utf8");
  await unlink(completionMarkerPath(root)).catch((error) => logPersonaFileSideEffectFailure("completion marker cleanup", error));
  return true;
}

export type PersonaCompletionSource = "telegram" | "web";

export async function writePersonaCompletionMarker(
  root: string,
  now = new Date(),
  source: PersonaCompletionSource = "telegram"
): Promise<string> {
  const path = completionMarkerPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ completedAt: now.toISOString(), source, version: 1 }, null, 2)}\n`,
    "utf8"
  );
  return path;
}
