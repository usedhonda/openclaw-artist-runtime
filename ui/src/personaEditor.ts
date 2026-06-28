import type { PersonaField } from "../../src/types";
import { personaCanonicalField, personaCanonicalTarget, personaFileContracts } from "../../src/services/personaCanonical";

export type ArtistPersonaDraft = {
  artistName: string;
  identityLine: string;
  soundDna: string;
  obsessions: string;
  lyricsRules: string;
  socialVoice: string;
};

export type SoulPersonaDraft = {
  conversationTone: string;
  refusalStyle: string;
};

export type SnapshotPersonaDraft = {
  identity: string;
  producer: string;
  inner: string;
};

export type PersonaEditorSource = {
  artist: ArtistPersonaDraft;
  soul: SoulPersonaDraft;
  identity: { text: string; readOnly?: boolean; source?: "derived" };
  producer: { text: string };
  inner: { text: string; readOnly?: boolean; source?: "internal" };
  setup: {
    completed: boolean;
    needsSetup: boolean;
    reasons: string[];
    reasonsText: string;
  };
  audit?: {
    summary: { filled: number; thin: number; missing: number };
    fields: Array<{ field: string; status: "filled" | "thin" | "missing"; reason?: string; current?: string; setupInput?: boolean }>;
    issues: Array<{ code: string; file: string; detail: string }>;
    customSections: string[];
  };
  aiDraftSupported: ["artist", "soul", "producer"];
  provider: string;
};

export type PersonaDraft = {
  artist: ArtistPersonaDraft;
  soul: SoulPersonaDraft;
  snapshots: SnapshotPersonaDraft;
};

export type PersonaDraftLayer = "artist" | "soul" | "identity" | "producer" | "inner";

export type PersonaFieldMeta<K> = {
  field: K;
  label: string;
  help: string;
  aiField: PersonaField;
  targetFile: string;
  multiline?: boolean;
};

export const artistPersonaFields: Array<PersonaFieldMeta<keyof ArtistPersonaDraft>> = [
  { field: "identityLine", label: personaCanonicalField("artistConcept").label, help: personaCanonicalField("artistConcept").help, aiField: "identityLine", targetFile: personaCanonicalTarget(personaCanonicalField("artistConcept")), multiline: true },
  { field: "soundDna", label: personaCanonicalField("soundDna").label, help: personaCanonicalField("soundDna").help, aiField: "soundDna", targetFile: personaCanonicalTarget(personaCanonicalField("soundDna")), multiline: true },
  { field: "obsessions", label: personaCanonicalField("obsessions").label, help: personaCanonicalField("obsessions").help, aiField: "obsessions", targetFile: personaCanonicalTarget(personaCanonicalField("obsessions")), multiline: true },
  { field: "lyricsRules", label: personaCanonicalField("lyricsRules").label, help: personaCanonicalField("lyricsRules").help, aiField: "lyricsRules", targetFile: personaCanonicalTarget(personaCanonicalField("lyricsRules")), multiline: true },
  { field: "socialVoice", label: personaCanonicalField("socialVoice").label, help: personaCanonicalField("socialVoice").help, aiField: "socialVoice", targetFile: personaCanonicalTarget(personaCanonicalField("socialVoice")), multiline: true }
];

export const soulPersonaFields: Array<PersonaFieldMeta<keyof SoulPersonaDraft>> = [
  { field: "conversationTone", label: personaCanonicalField("conversationTone").label, help: personaCanonicalField("conversationTone").help, aiField: "soul-tone", targetFile: personaCanonicalTarget(personaCanonicalField("conversationTone")), multiline: true },
  { field: "refusalStyle", label: personaCanonicalField("refusalStyle").label, help: personaCanonicalField("refusalStyle").help, aiField: "soul-refusal", targetFile: personaCanonicalTarget(personaCanonicalField("refusalStyle")), multiline: true }
];

export const producerContextField = {
  label: "制作判断メモ",
  help: personaCanonicalField("producerFacts").help,
  aiField: "producerFacts" as PersonaField,
  targetFile: personaCanonicalTarget(personaCanonicalField("producerFacts"))
};

export type PersonaLayerInfo = {
  layer: PersonaDraftLayer;
  file: string;
  role: string;
  summary: string;
  kind: string;
  requirement: string;
  purpose: string;
  write: string;
  avoid: string;
  editable: boolean;
};

/**
 * Persona layer metadata. Setup edits only user-input layers; generated/internal
 * layers can still be shown as read-only runtime projections.
 */
export const personaLayerMap: PersonaLayerInfo[] = [
  { layer: "artist", file: "ARTIST.md", role: "曲づくりの核", summary: personaFileContracts["ARTIST.md"].uiSummary, kind: personaFileContracts["ARTIST.md"].uiKind, requirement: personaFileContracts["ARTIST.md"].uiRequirement, purpose: personaFileContracts["ARTIST.md"].uiPurpose, write: personaFileContracts["ARTIST.md"].uiWrite, avoid: personaFileContracts["ARTIST.md"].uiAvoid, editable: true },
  { layer: "soul", file: "SOUL.md", role: "話し方", summary: personaFileContracts["SOUL.md"].uiSummary, kind: personaFileContracts["SOUL.md"].uiKind, requirement: personaFileContracts["SOUL.md"].uiRequirement, purpose: personaFileContracts["SOUL.md"].uiPurpose, write: personaFileContracts["SOUL.md"].uiWrite, avoid: personaFileContracts["SOUL.md"].uiAvoid, editable: true },
  { layer: "producer", file: "PRODUCER.md", role: "プロデューサー情報", summary: personaFileContracts["PRODUCER.md"].uiSummary, kind: personaFileContracts["PRODUCER.md"].uiKind, requirement: personaFileContracts["PRODUCER.md"].uiRequirement, purpose: personaFileContracts["PRODUCER.md"].uiPurpose, write: personaFileContracts["PRODUCER.md"].uiWrite, avoid: personaFileContracts["PRODUCER.md"].uiAvoid, editable: true },
  { layer: "identity", file: "IDENTITY.md", role: "自己紹介", summary: personaFileContracts["IDENTITY.md"].uiSummary, kind: personaFileContracts["IDENTITY.md"].uiKind, requirement: personaFileContracts["IDENTITY.md"].uiRequirement, purpose: personaFileContracts["IDENTITY.md"].uiPurpose, write: personaFileContracts["IDENTITY.md"].uiWrite, avoid: personaFileContracts["IDENTITY.md"].uiAvoid, editable: false },
  { layer: "inner", file: "INNER.md", role: "内部メモ", summary: personaFileContracts["INNER.md"].uiSummary, kind: personaFileContracts["INNER.md"].uiKind, requirement: personaFileContracts["INNER.md"].uiRequirement, purpose: personaFileContracts["INNER.md"].uiPurpose, write: personaFileContracts["INNER.md"].uiWrite, avoid: personaFileContracts["INNER.md"].uiAvoid, editable: false }
];

export function buildPersonaDraft(source: PersonaEditorSource): PersonaDraft {
  return {
    artist: { ...source.artist },
    soul: { ...source.soul },
    snapshots: {
      identity: source.identity.text,
      producer: source.producer.text,
      inner: source.inner.text
    }
  };
}

export function validatePersonaDraft(draft: PersonaDraft, layer?: PersonaDraftLayer): string | null {
  if ((!layer || layer === "soul") && draft.soul.conversationTone.trim().length < 5) {
    return "conversationTone must be at least 5 characters";
  }
  if ((!layer || layer === "soul") && draft.soul.refusalStyle.trim().length < 8) {
    return "refusalStyle must be at least 8 characters";
  }
  const snapshotEntries: Array<[PersonaDraftLayer, string]> = [["producer", draft.snapshots.producer]];
  const tooLong = snapshotEntries.find(([entryLayer, text]) => (!layer || layer === entryLayer) && text.length > 20_000);
  return tooLong ? `${tooLong[0]} text must be 20000 characters or fewer` : null;
}

export function buildPersonaArtistPatch(draft: PersonaDraft): { artist: Omit<ArtistPersonaDraft, "artistName"> } {
  const { artistName: _artistName, ...artist } = draft.artist;
  return { artist };
}

export function buildPersonaSoulPatch(draft: PersonaDraft): { soul: SoulPersonaDraft } {
  return { soul: { ...draft.soul } };
}

export function buildPersonaSnapshotPatch(draft: PersonaDraft, layer: "identity" | "producer" | "inner"): Record<string, { text: string }> {
  return { [layer]: { text: draft.snapshots[layer] } };
}

export function emptyPersonaDraftFields(draft: PersonaDraft): PersonaField[] {
  const fields: PersonaField[] = [];
  for (const field of artistPersonaFields) {
    if (!draft.artist[field.field].trim()) fields.push(field.aiField);
  }
  for (const field of soulPersonaFields) {
    if (!draft.soul[field.field].trim()) fields.push(field.aiField);
  }
  if (!draft.snapshots.producer.trim()) fields.push(producerContextField.aiField);
  return fields;
}

export function editablePersonaDraftFields(): PersonaField[] {
  return [
    ...artistPersonaFields.map((field) => field.aiField),
    ...soulPersonaFields.map((field) => field.aiField),
    producerContextField.aiField
  ];
}
