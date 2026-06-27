import type { PersonaField } from "../../src/types";

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
  identity: { text: string };
  producer: { text: string };
  inner: { text: string };
  setup: {
    completed: boolean;
    needsSetup: boolean;
    reasons: string[];
    reasonsText: string;
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

export const artistPersonaFields: Array<{ field: keyof ArtistPersonaDraft; label: string; aiField: PersonaField; multiline?: boolean }> = [
  { field: "artistName", label: "Artist name", aiField: "artistName" },
  { field: "identityLine", label: "Identity line", aiField: "identityLine", multiline: true },
  { field: "soundDna", label: "Sound DNA", aiField: "soundDna", multiline: true },
  { field: "obsessions", label: "Obsessions", aiField: "obsessions", multiline: true },
  { field: "lyricsRules", label: "Lyrics rules", aiField: "lyricsRules", multiline: true },
  { field: "socialVoice", label: "Social voice", aiField: "socialVoice", multiline: true }
];

export const soulPersonaFields: Array<{ field: keyof SoulPersonaDraft; label: string; aiField: PersonaField; multiline?: boolean }> = [
  { field: "conversationTone", label: "Conversation tone", aiField: "soul-tone", multiline: true },
  { field: "refusalStyle", label: "Refusal style", aiField: "soul-refusal", multiline: true }
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
  if ((!layer || layer === "artist") && draft.artist.artistName.trim().length === 0) {
    return "artistName is required";
  }
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

export function buildPersonaArtistPatch(draft: PersonaDraft): { artist: ArtistPersonaDraft } {
  return { artist: { ...draft.artist } };
}

export function buildPersonaSoulPatch(draft: PersonaDraft): { soul: SoulPersonaDraft } {
  return { soul: { ...draft.soul } };
}

export function buildPersonaSnapshotPatch(draft: PersonaDraft, layer: "identity" | "producer" | "inner"): Record<string, { text: string }> {
  return { [layer]: { text: draft.snapshots[layer] } };
}
