import type { AiReviewProvider, PersonaField } from "../types.js";
import { callAiProvider } from "./aiProviderClient.js";
import { secretLikePattern, parseIntentDirectives } from "./personaMigrator.js";
import { personaAiProposableFields, personaCanonicalLegacyKey } from "./personaCanonical.js";
import { soulPersonaQuestions } from "./soulFileBuilder.js";
import { extractPersonaMotifs, summarizeMotifs, type PersonaMotifBundle } from "./personaMotifExtractor.js";

export type PersonaProposerMode = "fill_missing" | "review_all" | "dedupe";

export interface PersonaProposerSourceContext {
  artistMd: string;
  soulMd: string;
  producerMd?: string;
  roughInput?: string;
  customSections?: string[];
  motifs?: PersonaMotifBundle;
}

export interface PersonaFieldDraft {
  field: PersonaField;
  draft: string;
  reasoning?: string;
  status: "proposed" | "skipped" | "low_confidence";
}

export interface PersonaProposerRequest {
  fields: PersonaField[];
  mode?: PersonaProposerMode;
  source: PersonaProposerSourceContext;
}

export interface PersonaProposerResult {
  drafts: PersonaFieldDraft[];
  provider: AiReviewProvider | "mock" | "not_configured";
  warnings: string[];
}

export const defaultArtistPersonaFieldValues: Record<Extract<PersonaField, "identityLine" | "soundDna" | "obsessions" | "lyricsRules" | "socialVoice">, string> = {
  identityLine: "A public musical artist that turns observations into autonomous songs.",
  soundDna: "alternative pop, glassy synth texture, close controlled vocal",
  obsessions: "night infrastructure, private signals, lonely machines",
  lyricsRules: "avoid cheap hope, direct imitation, generic slogans, and corporate uplift",
  socialVoice: "short, observant, unsalesy, concrete"
};

const fieldDefaults = new Map<PersonaField, string>([
  ...Object.entries(defaultArtistPersonaFieldValues) as Array<[PersonaField, string]>,
  ["soul-tone", soulPersonaQuestions[0].defaultValue],
  ["soul-refusal", soulPersonaQuestions[1].defaultValue],
  ["producerFacts", "制作判断に効く好み、制約、避けたい方向を短くまとめる。"]
]);

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

function statusForField(raw: string, field: PersonaField): PersonaFieldDraft["status"] {
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

function ensureMotifs(source: PersonaProposerSourceContext): PersonaMotifBundle {
  return source.motifs ?? extractPersonaMotifs(source.artistMd);
}

function motifConversationTone(motifs: PersonaMotifBundle): string | undefined {
  const themes = motifs.themes.slice(0, 3);
  if (themes.length === 0) return undefined;
  const themeList = themes.join("・");
  return `${themeList}を直球で語る。事実を述べず、景色と行動で切る。`;
}

function motifRefusalStyle(motifs: PersonaMotifBundle): string | undefined {
  const avoid = motifs.avoid.slice(0, 3);
  if (avoid.length === 0) return undefined;
  const avoidList = avoid.join("・");
  return `${avoidList}は受け流す。説明口調を避け、皮肉で切り返す。`;
}

function motifAwareDefault(field: PersonaField, motifs: PersonaMotifBundle): string | undefined {
  if (field === "soul-tone") return motifConversationTone(motifs);
  if (field === "soul-refusal") return motifRefusalStyle(motifs);
  return undefined;
}

export function buildPersonaProposerPrompt(req: PersonaProposerRequest): string {
  const motifSummary = summarizeMotifs(ensureMotifs(req.source));
  return [
    "System: You help build a concise musical artist persona.",
    "Return one line per requested field using: fieldKey: value (origin: source).",
    "Keep each value under 200 characters. Do not include secrets, tokens, cookies, or credentials.",
  "Anchor every proposal to the persona motifs below; do not propose values that contradict them.",
    "Do not propose artist display names or producer callnames; those are config identity values, not persona Markdown.",
    req.mode === "review_all"
      ? "Mode: review_all. Suggest concise improvements for the requested fields without assuming the user approved saving."
      : req.mode === "dedupe"
        ? "Mode: dedupe. Suggest values that move facts back to their canonical owner and remove cross-file duplication."
        : "Mode: fill_missing. Fill only the requested blank fields.",
    "",
    `Requested fields: ${req.fields.join(", ")}`,
    motifSummary ? `Persona motifs (anchor): ${motifSummary}` : "Persona motifs (anchor): (none)",
    req.source.roughInput ? `Rough input: ${req.source.roughInput}` : "Rough input: (none)",
    req.source.customSections?.length ? `Custom sections: ${req.source.customSections.join(", ")}` : "Custom sections: (none)",
    "",
    "ARTIST.md:",
    truncate(req.source.artistMd, 4000),
    "",
    "SOUL.md:",
    truncate(req.source.soulMd, 2000),
    "",
    "PRODUCER.md:",
    truncate(req.source.producerMd ?? "", 2000)
  ].join("\n");
}

export function parsePersonaProposerResponse(raw: string, fields: PersonaField[]): PersonaFieldDraft[] {
  const directives = parseIntentDirectives(raw);
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

function mockDrafts(fields: PersonaField[], motifs: PersonaMotifBundle): PersonaFieldDraft[] {
  const motifSummary = summarizeMotifs(motifs);
  return fields.map((field) => {
    const motifAware = motifAwareDefault(field, motifs);
    if (motifAware) {
      return {
        field,
        draft: motifAware,
        status: "proposed",
        reasoning: motifSummary ? `mock provider derived from motifs: ${motifSummary}` : "mock provider default"
      };
    }
    return {
      field,
      draft: fieldDefaults.get(field) ?? "<TBD>",
      status: "proposed",
      reasoning: "mock provider default"
    };
  });
}

export function personaDefaultProposalFields(): PersonaField[] {
  return personaAiProposableFields().map((field) => personaCanonicalLegacyKey(field) as PersonaField);
}

function secretFieldsFromDirectives(value: string | undefined, fields: PersonaField[]): Set<PersonaField> {
  if (!value) {
    return new Set();
  }
  const directives = parseIntentDirectives(value);
  const secretFields = new Set<PersonaField>();
  for (const field of fields) {
    const directive = directives.get(field);
    if (directive && secretLikePattern.test(directive.value)) {
      secretFields.add(field);
    }
  }
  return secretFields;
}

function applySecretSkips(drafts: PersonaFieldDraft[], secretFields: Set<PersonaField>, reason: string): PersonaFieldDraft[] {
  return drafts.map((draft) =>
    secretFields.has(draft.field)
      ? { field: draft.field, draft: "", status: "skipped", reasoning: reason }
      : draft
  );
}

const APPEND_ONLY_DENSITY_THRESHOLD = 5000;

export function isPersonaAppendOnly(soulMd: string | undefined, artistMd: string | undefined): boolean {
  const total = (soulMd?.length ?? 0) + (artistMd?.length ?? 0);
  return total > APPEND_ONLY_DENSITY_THRESHOLD;
}

export async function proposePersonaFields(
  req: PersonaProposerRequest,
  options: { aiReviewProvider?: AiReviewProvider } = {}
): Promise<PersonaProposerResult> {
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
  const motifs = ensureMotifs(req.source);
  const appendOnlyMode = isPersonaAppendOnly(req.source.soulMd, req.source.artistMd);
  if (appendOnlyMode) {
    warnings.push(
      `persona files exceed ${APPEND_ONLY_DENSITY_THRESHOLD} chars; AI suggestions are draft-only and do not overwrite saved text`
    );
  }
  if (provider === "mock") {
    return {
      provider: "mock",
      warnings,
      drafts: applySecretSkips(mockDrafts(req.fields, motifs), roughInputSecretFields, "secret-like rough input")
    };
  }
  const raw = await callAiProvider(buildPersonaProposerPrompt(req), { provider });
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
    applySecretSkips(parsePersonaProposerResponse(raw, req.fields), roughInputSecretFields, "secret-like rough input"),
    responseSecretFields,
    "secret-like AI response"
  );
  if (raw.includes("is not configured")) {
    warnings.push(`AI provider ${provider} is not configured; parsed fallback response only`);
    return { provider: "not_configured", warnings, drafts };
  }
  return { provider, warnings, drafts };
}
