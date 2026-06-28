import type { PersonaField } from "../../src/types";
import { personaCanonicalField } from "../../src/services/personaCanonical";

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
  aiDraftSupported: ["artist", "soul"];
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
  multiline?: boolean;
};

export const artistPersonaFields: Array<PersonaFieldMeta<keyof ArtistPersonaDraft>> = [
  { field: "identityLine", label: `ARTIST.md / ${personaCanonicalField("artistConcept").label}`, help: personaCanonicalField("artistConcept").help, aiField: "identityLine", multiline: true },
  { field: "soundDna", label: `ARTIST.md / ${personaCanonicalField("soundDna").label}`, help: personaCanonicalField("soundDna").help, aiField: "soundDna", multiline: true },
  { field: "obsessions", label: `ARTIST.md / ${personaCanonicalField("obsessions").label}`, help: personaCanonicalField("obsessions").help, aiField: "obsessions", multiline: true },
  { field: "lyricsRules", label: `ARTIST.md / ${personaCanonicalField("lyricsRules").label}`, help: personaCanonicalField("lyricsRules").help, aiField: "lyricsRules", multiline: true },
  { field: "socialVoice", label: `ARTIST.md / ${personaCanonicalField("socialVoice").label}`, help: personaCanonicalField("socialVoice").help, aiField: "socialVoice", multiline: true }
];

export const soulPersonaFields: Array<PersonaFieldMeta<keyof SoulPersonaDraft>> = [
  { field: "conversationTone", label: `SOUL.md / ${personaCanonicalField("conversationTone").label}`, help: personaCanonicalField("conversationTone").help, aiField: "soul-tone", multiline: true },
  { field: "refusalStyle", label: `SOUL.md / ${personaCanonicalField("refusalStyle").label}`, help: personaCanonicalField("refusalStyle").help, aiField: "soul-refusal", multiline: true }
];

export const producerContextField = {
  label: "PRODUCER.md / 制作判断メモ",
  help: personaCanonicalField("producerFacts").help,
  aiField: "producerFacts" as PersonaField
};

export type PersonaLayerInfo = {
  layer: PersonaDraftLayer;
  file: string;
  role: string;
  summary: string;
  editable: boolean;
};

/**
 * Persona layer metadata. Setup edits only user-input layers; generated/internal
 * layers can still be shown as read-only runtime projections.
 */
export const personaLayerMap: PersonaLayerInfo[] = [
  { layer: "artist", file: "ARTIST.md", role: "曲づくりの核", summary: "テーマ・音・歌詞・公開投稿の声", editable: true },
  { layer: "soul", file: "SOUL.md", role: "話し方", summary: "あなたと話す時の口調・断り方", editable: true },
  { layer: "identity", file: "IDENTITY.md", role: "自己紹介", summary: "名前や入力内容から自動で作る表示", editable: false },
  { layer: "producer", file: "PRODUCER.md", role: "プロデューサー情報", summary: "好み・制約・判断材料", editable: true },
  { layer: "inner", file: "INNER.md", role: "内部メモ", summary: "Setup では編集しない。既存内容は保持", editable: false }
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
