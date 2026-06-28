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
  inner: { text: string };
  setup: {
    completed: boolean;
    needsSetup: boolean;
    reasons: string[];
    reasonsText: string;
  };
  audit?: {
    summary: { filled: number; thin: number; missing: number };
    fields: Array<{ field: string; status: "filled" | "thin" | "missing"; reason?: string; current?: string }>;
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
  { field: "identityLine", label: personaCanonicalField("artistConcept").label, help: personaCanonicalField("artistConcept").help, aiField: "identityLine", multiline: true },
  { field: "soundDna", label: personaCanonicalField("soundDna").label, help: personaCanonicalField("soundDna").help, aiField: "soundDna", multiline: true },
  { field: "obsessions", label: personaCanonicalField("obsessions").label, help: personaCanonicalField("obsessions").help, aiField: "obsessions", multiline: true },
  { field: "lyricsRules", label: personaCanonicalField("lyricsRules").label, help: personaCanonicalField("lyricsRules").help, aiField: "lyricsRules", multiline: true },
  { field: "socialVoice", label: personaCanonicalField("socialVoice").label, help: personaCanonicalField("socialVoice").help, aiField: "socialVoice", multiline: true }
];

export const soulPersonaFields: Array<PersonaFieldMeta<keyof SoulPersonaDraft>> = [
  { field: "conversationTone", label: personaCanonicalField("conversationTone").label, help: personaCanonicalField("conversationTone").help, aiField: "soul-tone", multiline: true },
  { field: "refusalStyle", label: personaCanonicalField("refusalStyle").label, help: personaCanonicalField("refusalStyle").help, aiField: "soul-refusal", multiline: true }
];

export type PersonaLayerInfo = {
  layer: PersonaDraftLayer;
  file: string;
  role: string;
  summary: string;
  editable: boolean;
};

/**
 * 5層マップ用のメタ。Setup タブ上部の概観カードと各 section の役割見出しに使う。
 * ファイル名は残しつつ、人間語の役割を主役にするための情報源。
 */
export const personaLayerMap: PersonaLayerInfo[] = [
  { layer: "artist", file: "ARTIST.md", role: "創作の核", summary: "音・主題・歌詞ルールなど曲づくりの土台", editable: true },
  { layer: "soul", file: "SOUL.md", role: "会話人格", summary: "話すときの声・温度・断り方", editable: true },
  { layer: "identity", file: "IDENTITY.md", role: "自己紹介", summary: "config と persona から生成される表示カード", editable: false },
  { layer: "producer", file: "PRODUCER.md", role: "プロデューサー像", summary: "制作判断に効く事実", editable: true },
  { layer: "inner", file: "INNER.md", role: "内面", summary: "表に出ない創作圧", editable: true }
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
  const snapshotEntries: Array<[PersonaDraftLayer, string]> = [
    ["identity", draft.snapshots.identity],
    ["producer", draft.snapshots.producer],
    ["inner", draft.snapshots.inner]
  ];
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
