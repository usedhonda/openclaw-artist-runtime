import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PersonaAnswers } from "../types.js";
import { assertPersonaBlockSafe } from "./personaFileBuilder.js";

export const soulPersonaBlockStart = "<!-- artist-runtime:persona:soul:start -->";
export const soulPersonaBlockEnd = "<!-- artist-runtime:persona:soul:end -->";

export interface SoulPersonaSummary {
  conversationTone: string;
  refusalStyle: string;
}

export interface SoulPersonaQuestion {
  field: "conversationTone" | "refusalStyle";
  label: string;
  prompt: string;
  defaultValue: string;
  validate: (value: string) => string | undefined;
}

export interface WriteSoulPersonaResult {
  path: string;
  mode: "replace_marker" | "append_marker" | "create_file";
}

const minTextLength = (label: string, minLength: number) => (value: string): string | undefined =>
  value.trim().length >= minLength ? undefined : `${label} must be at least ${minLength} characters.`;

export const soulPersonaQuestions: SoulPersonaQuestion[] = [
  {
    field: "conversationTone",
    label: "Conversation tone",
    prompt: "S1. Producer と話す距離感は？例: 短く率直 / 少し詩的 / 強めに意見する / 穏やかに伴走",
    defaultValue: "short, direct, observant, and artistically opinionated",
    validate: minTextLength("Conversation tone", 5)
  },
  {
    field: "refusalStyle",
    label: "Refusal style",
    prompt: "S2. 弱い案や危ない案をどう断りますか？一文で。例: 逃げずに理由を言い、代替案を1つ出す。",
    defaultValue: "Refuse weak or unsafe ideas with a clear reason and one stronger alternative.",
    validate: minTextLength("Refusal style", 8)
  }
];

function soulPath(root: string): string {
  return join(root, "SOUL.md");
}

function replaceMarkerBlock(contents: string, block: string): string {
  const expression = new RegExp(`${soulPersonaBlockStart}[\\s\\S]*?${soulPersonaBlockEnd}`);
  return contents.replace(expression, block);
}

function removeMarkerBlock(contents: string): string {
  const expression = new RegExp(`\\n?${soulPersonaBlockStart}[\\s\\S]*?${soulPersonaBlockEnd}\\n?`);
  return contents.replace(expression, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function insertAfterSoulHeading(contents: string, block: string): string {
  const heading = /^# SOUL\.md\s*$/m;
  if (!heading.test(contents)) {
    return `${block}\n\n${contents.trimEnd()}\n`;
  }
  return contents.replace(heading, `# SOUL.md\n\n${block}`);
}

export function completeSoulPersonaAnswers(pending: Partial<PersonaAnswers>): SoulPersonaSummary {
  return {
    conversationTone: String(pending.conversationTone ?? soulPersonaQuestions[0].defaultValue),
    refusalStyle: String(pending.refusalStyle ?? soulPersonaQuestions[1].defaultValue)
  };
}

export function buildSoulPersonaBlock(pending: Partial<PersonaAnswers>): string {
  const answers = completeSoulPersonaAnswers(pending);
  return [
    soulPersonaBlockStart,
    "## Telegram Persona Voice",
    "",
    `Conversation tone: ${answers.conversationTone}`,
    `Refusal style: ${answers.refusalStyle}`,
    "",
    "When talking to the producer, preserve the artist's agency. Be operational when needed, but do not collapse into generic assistant phrasing.",
    soulPersonaBlockEnd
  ].join("\n");
}

export function formatSoulPersonaPreview(pending: Partial<PersonaAnswers>): string {
  const answers = completeSoulPersonaAnswers(pending);
  return [
    "SOUL preview:",
    `Conversation tone: ${answers.conversationTone}`,
    `Refusal style: ${answers.refusalStyle}`,
    "",
    "Write this to SOUL.md? Reply /confirm, or keep discussing changes naturally."
  ].join("\n");
}

export async function readSoulPersonaSummary(root: string): Promise<SoulPersonaSummary> {
  const contents = await readFile(soulPath(root), "utf8").catch(() => "");
  return {
    conversationTone: contents.match(/^Conversation tone:[ \t]*(.*)$/m)?.[1]?.trim() || "",
    refusalStyle: contents.match(/^Refusal style:[ \t]*(.*)$/m)?.[1]?.trim() || ""
  };
}

export async function writeSoulPersona(root: string, pending: Partial<PersonaAnswers>): Promise<WriteSoulPersonaResult> {
  const path = soulPath(root);
  const existing = await readFile(path, "utf8").catch(() => "");
  const block = buildSoulPersonaBlock(pending);
  assertPersonaBlockSafe(block);
  let mode: WriteSoulPersonaResult["mode"];
  let nextContents: string;
  if (!existing.trim()) {
    mode = "create_file";
    nextContents = `# SOUL.md\n\n${block}\n`;
  } else if (existing.includes(soulPersonaBlockStart) && existing.includes(soulPersonaBlockEnd)) {
    mode = "replace_marker";
    nextContents = replaceMarkerBlock(existing, block);
  } else {
    mode = "append_marker";
    nextContents = insertAfterSoulHeading(existing, block);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, nextContents.endsWith("\n") ? nextContents : `${nextContents}\n`, "utf8");
  return { path, mode };
}

export async function updateSoulPersonaField(
  root: string,
  field: keyof SoulPersonaSummary,
  value: string
): Promise<WriteSoulPersonaResult> {
  const current = await readSoulPersonaSummary(root);
  return writeSoulPersona(root, { ...current, [field]: value });
}

export async function resetSoulPersonaBlock(root: string): Promise<boolean> {
  const path = soulPath(root);
  const contents = await readFile(path, "utf8").catch(() => "");
  if (!contents.includes(soulPersonaBlockStart) || !contents.includes(soulPersonaBlockEnd)) {
    return false;
  }
  const nextContents = removeMarkerBlock(contents);
  await writeFile(path, nextContents ? `${nextContents}\n` : "", "utf8");
  return true;
}
