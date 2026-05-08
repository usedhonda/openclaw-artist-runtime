import type { AiReviewProvider, SongUpdateField } from "../types.js";
import { songUpdateFields } from "../types.js";
import { callAiProvider, isAiNotConfiguredResponse } from "./aiProviderClient.js";
import { secretLikePattern } from "./personaMigrator.js";

export interface SongProposerSourceContext {
  songId: string;
  songMd: string;
  briefMd: string;
  songbookEntry: string;
  currentState: string;
  roughInput?: string;
}

export interface SongFieldDraft {
  field: SongUpdateField;
  draft: string;
  reasoning?: string;
  status: "proposed" | "skipped" | "low_confidence";
}

export interface SongProposerRequest {
  fields: SongUpdateField[];
  source: SongProposerSourceContext;
}

export interface SongProposerResult {
  drafts: SongFieldDraft[];
  provider: AiReviewProvider | "mock" | "not_configured";
  warnings: string[];
}

interface ParsedSongDirective {
  field: SongUpdateField;
  value: string;
  skip: boolean;
}

const fieldDefaults = new Map<SongUpdateField, string>([
  ["title", "Untitled OpenClaw Song"],
  ["brief", "A concise song brief for the next artist-runtime cycle."],
  ["style", "intimate alternative pop with restrained electronic texture"],
  ["lyrics", "Draft lyrics pending producer review."],
  ["status", "idea"],
  ["publicLinksSpotify", "TBD"],
  ["publicLinksAppleMusic", "TBD"],
  ["publicLinksYoutubeMusic", "TBD"],
  ["publicLinksOther", "TBD"],
  ["selectedTake", "TBD"],
  ["notes", "No additional notes yet."],
  ["nextAction", "Review with the producer before writing song files."]
]);

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

function fieldAliases(field: SongUpdateField): string[] {
  switch (field) {
    case "title":
      return ["title", "song title", "name"];
    case "brief":
      return ["brief", "song brief", "concept", "summary"];
    case "style":
      return ["style", "sound", "suno style", "production style"];
    case "lyrics":
      return ["lyrics", "lyric", "draft lyrics"];
    case "status":
      return ["status", "song status", "state"];
    case "publicLinksSpotify":
      return ["publicLinksSpotify", "public links spotify", "spotify", "spotify url", "spotify link"];
    case "publicLinksAppleMusic":
      return ["publicLinksAppleMusic", "public links apple music", "apple music", "apple music url", "apple"];
    case "publicLinksYoutubeMusic":
      return ["publicLinksYoutubeMusic", "public links youtube music", "youtube music", "youtube", "youtube url"];
    case "publicLinksOther":
      return ["publicLinksOther", "public links other", "other link", "other url", "public link"];
    case "selectedTake":
      return ["selectedTake", "selected take", "take", "take id"];
    case "notes":
      return ["notes", "note", "song notes", "update notes"];
    case "nextAction":
      return ["nextAction", "next action", "next", "todo"];
  }
}

function normalizeDirectiveKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function buildAliasMap(): Map<string, SongUpdateField> {
  const aliases = new Map<string, SongUpdateField>();
  for (const field of songUpdateFields) {
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

function parseSongDirectives(input: string): Map<SongUpdateField, ParsedSongDirective> {
  const directives = new Map<SongUpdateField, ParsedSongDirective>();
  const aliasMap = buildAliasMap();
  let currentField: SongUpdateField | undefined;

  for (const rawLine of input.split(/\r?\n/)) {
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

function statusForField(raw: string, field: SongUpdateField): SongFieldDraft["status"] {
  return secretLikePattern.test(raw) ? "skipped" : fieldDefaults.has(field) ? "proposed" : "low_confidence";
}

function splitOrigin(value: string): { draft: string; reasoning?: string } {
  const match = value.match(/\s*\(origin:\s*([^)]+)\)\s*$/i);
  if (!match) {
    return { draft: value.trim() };
  }
  return {
    draft: value.slice(0, match.index).trim(),
    reasoning: match[1].trim()
  };
}

export function buildSongProposerPrompt(req: SongProposerRequest): string {
  return [
    "System: You help update musical artist song lifecycle files.",
    "Return one line per requested field using: fieldKey: value (origin: source).",
    "Keep each value under 220 characters. Do not include secrets, tokens, cookies, credentials, or private config.",
    "",
    `Song ID: ${req.source.songId}`,
    `Requested fields: ${req.fields.join(", ")}`,
    req.source.roughInput ? `Rough input: ${req.source.roughInput}` : "Rough input: (none)",
    "",
    "artist/SONGBOOK.md entry:",
    truncate(req.source.songbookEntry, 1600),
    "",
    "songs/<id>/song.md:",
    truncate(req.source.songMd, 3000),
    "",
    "songs/<id>/brief.md:",
    truncate(req.source.briefMd, 1800),
    "",
    "artist/CURRENT_STATE.md:",
    truncate(req.source.currentState, 1800)
  ].join("\n");
}

export function parseSongProposerResponse(raw: string, fields: SongUpdateField[]): SongFieldDraft[] {
  const directives = parseSongDirectives(raw);
  return fields.map((field) => {
    const directive = directives.get(field);
    if (!directive) {
      return {
        field,
        draft: fieldDefaults.get(field) ?? "<TBD>",
        status: "low_confidence",
        reasoning: "provider response did not include this field"
      };
    }
    if (directive.skip) {
      return { field, draft: "", status: "skipped", reasoning: "provider requested skip" };
    }
    const parsed = splitOrigin(directive.value);
    return {
      field,
      draft: parsed.draft,
      reasoning: parsed.reasoning,
      status: statusForField(parsed.draft, field)
    };
  });
}

function mockDrafts(fields: SongUpdateField[]): SongFieldDraft[] {
  return fields.map((field) => ({
    field,
    draft: fieldDefaults.get(field) ?? "<TBD>",
    status: "proposed",
    reasoning: "mock provider default"
  }));
}

function secretFieldsFromDirectives(value: string | undefined, fields: SongUpdateField[]): Set<SongUpdateField> {
  if (!value) {
    return new Set();
  }
  const directives = parseSongDirectives(value);
  const secretFields = new Set<SongUpdateField>();
  for (const field of fields) {
    const directive = directives.get(field);
    if (directive && secretLikePattern.test(directive.value)) {
      secretFields.add(field);
    }
  }
  return secretFields;
}

function applySecretSkips(
  drafts: SongFieldDraft[],
  secretFields: Set<SongUpdateField>,
  reason: string
): SongFieldDraft[] {
  return drafts.map((draft) =>
    secretFields.has(draft.field)
      ? { field: draft.field, draft: "", status: "skipped", reasoning: reason }
      : draft
  );
}

export async function proposeSongFields(
  req: SongProposerRequest,
  options: { aiReviewProvider?: AiReviewProvider } = {}
): Promise<SongProposerResult> {
  const provider = options.aiReviewProvider ?? "mock";
  const warnings: string[] = [];
  const roughInputSecretFields = secretFieldsFromDirectives(req.source.roughInput, req.fields);
  if (roughInputSecretFields.size > 0) {
    warnings.push(`rough input contains secret-like text for: ${[...roughInputSecretFields].join(", ")}`);
  } else if (req.source.roughInput && secretLikePattern.test(req.source.roughInput)) {
    warnings.push("rough input contains secret-like text; requested fields were skipped");
    return {
      provider,
      warnings,
      drafts: req.fields.map((field) => ({ field, draft: "", status: "skipped", reasoning: "secret-like rough input" }))
    };
  }
  if (provider === "mock") {
    return {
      provider: "mock",
      warnings,
      drafts: applySecretSkips(mockDrafts(req.fields), roughInputSecretFields, "secret-like rough input")
    };
  }
  const raw = await callAiProvider(buildSongProposerPrompt(req), { provider });
  const responseSecretFields = secretFieldsFromDirectives(raw, req.fields);
  if (responseSecretFields.size > 0) {
    warnings.push(`AI response contains secret-like text for: ${[...responseSecretFields].join(", ")}`);
  } else if (secretLikePattern.test(raw)) {
    warnings.push("AI response contains secret-like text; requested fields were skipped");
    return {
      provider,
      warnings,
      drafts: req.fields.map((field) => ({ field, draft: "", status: "skipped", reasoning: "secret-like AI response" }))
    };
  }
  const drafts = applySecretSkips(
    applySecretSkips(parseSongProposerResponse(raw, req.fields), roughInputSecretFields, "secret-like rough input"),
    responseSecretFields,
    "secret-like AI response"
  );
  if (isAiNotConfiguredResponse(raw)) {
    warnings.push(`AI provider ${provider} is not configured; parsed fallback response only`);
    return { provider: "not_configured", warnings, drafts };
  }
  return { provider, warnings, drafts };
}
