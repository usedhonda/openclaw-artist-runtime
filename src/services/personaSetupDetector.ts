import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PersonaCompletionMarker {
  completedAt: string;
  source: "telegram";
  version: 1;
}

export interface PersonaSetupStatus {
  completed: boolean;
  needsSetup: boolean;
  reasons: string[];
  marker?: PersonaCompletionMarker;
}

export interface PersonaSetupDetectorOptions {
  templateArtistPath?: string;
}

const artistNameTbdPattern = /(^|\n)\s*Artist name:\s*(?:TBD|Unnamed OpenClaw Artist)?\s*(\n|$)/i;
const sunoProfileNameTbdPattern = /(^|\n)\s*name:\s*TBD\s*(\n|$)/i;

function markerPath(root: string): string {
  return join(root, "runtime", "persona-completed.json");
}

function artistPath(root: string): string {
  return join(root, "ARTIST.md");
}

function hashContents(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readCompletionMarker(root: string): Promise<PersonaCompletionMarker | undefined> {
  const contents = await readFile(markerPath(root), "utf8").catch(() => "");
  if (!contents) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(contents) as Partial<PersonaCompletionMarker>;
    return parsed.source === "telegram" && parsed.version === 1 && typeof parsed.completedAt === "string"
      ? { completedAt: parsed.completedAt, source: "telegram", version: 1 }
      : undefined;
  } catch {
    return undefined;
  }
}

async function matchesTemplate(contents: string, templateArtistPath?: string): Promise<boolean> {
  if (!templateArtistPath) {
    return false;
  }
  const template = await readFile(templateArtistPath, "utf8").catch(() => "");
  return Boolean(template) && hashContents(template) === hashContents(contents);
}

export async function readPersonaSetupStatus(
  root: string,
  options: PersonaSetupDetectorOptions = {}
): Promise<PersonaSetupStatus> {
  const [marker, artistContents] = await Promise.all([
    readCompletionMarker(root),
    readFile(artistPath(root), "utf8").catch(() => "")
  ]);
  const reasons: string[] = [];
  const missingArtistFile = !artistContents;
  const artistNameTbd = artistNameTbdPattern.test(artistContents);
  const sunoProfileNameTbd = sunoProfileNameTbdPattern.test(artistContents);
  const defaultTemplateMatch = await matchesTemplate(artistContents, options.templateArtistPath);
  const completedExternalImport =
    !marker && !missingArtistFile && !artistNameTbd && !sunoProfileNameTbd && !defaultTemplateMatch;

  if (!marker && !completedExternalImport) {
    reasons.push("missing_completion_marker");
  }
  if (missingArtistFile) {
    reasons.push("missing_artist_file");
  }
  if (artistNameTbd) {
    reasons.push("artist_name_tbd");
  }
  if (sunoProfileNameTbd) {
    reasons.push("suno_profile_name_tbd");
  }
  if (defaultTemplateMatch) {
    reasons.push("matches_default_template_hash");
  }

  return {
    completed: (Boolean(marker) || completedExternalImport) && reasons.length === 0,
    needsSetup: reasons.length > 0,
    reasons,
    marker
  };
}

const personaSetupReasonText: Record<string, string> = {
  missing_completion_marker: "setup not completed",
  missing_artist_file: "ARTIST.md missing",
  artist_name_tbd: "artist name not set",
  suno_profile_name_tbd: "Suno profile name not set",
  matches_default_template_hash: "still the example template"
};

/**
 * Render setup reason codes as plain operator-facing text. Keeps the Producer
 * Console checklist actionable instead of surfacing raw codes like
 * `artist_name_tbd`. Unknown codes fall back to the raw value.
 */
export function describePersonaSetupReasons(reasons: string[]): string {
  const described = reasons.map((reason) => personaSetupReasonText[reason] ?? reason);
  return described.length > 0 ? described.join(", ") : "setup incomplete";
}
