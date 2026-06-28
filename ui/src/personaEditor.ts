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
  { field: "artistName", label: "アーティスト名", help: "全曲・SNS・自己紹介で使う表の名前。", aiField: "artistName" },
  { field: "identityLine", label: "自己定義", help: "一文の自己定義。AI が毎セッション参照する自己像に効く。", aiField: "identityLine", multiline: true },
  { field: "soundDna", label: "音の核", help: "Suno Style と曲調に効く音の核。例: nu-jazz rap, dry drums, 108 BPM, male vocal", aiField: "soundDna", multiline: true },
  { field: "obsessions", label: "執着テーマ", help: "繰り返し拾う主題。曲の提案や news/X 観察の選び方に効く。", aiField: "obsessions", multiline: true },
  { field: "lyricsRules", label: "歌詞ルール", help: "歌詞で守る制約。言語・避ける語・構造に効く。", aiField: "lyricsRules", multiline: true },
  { field: "socialVoice", label: "SNS の声", help: "Telegram や SNS での短い喋り方に効く。", aiField: "socialVoice", multiline: true }
];

export const soulPersonaFields: Array<PersonaFieldMeta<keyof SoulPersonaDraft>> = [
  { field: "conversationTone", label: "会話の温度", help: "会話の温度・距離感に効く。どんな空気で話すか。", aiField: "soul-tone", multiline: true },
  { field: "refusalStyle", label: "断り方", help: "断りたいときの言い方に効く。", aiField: "soul-refusal", multiline: true }
];

export type PersonaLayerInfo = {
  layer: PersonaDraftLayer;
  file: string;
  role: string;
  summary: string;
};

/**
 * 5層マップ用のメタ。Setup タブ上部の概観カードと各 section の役割見出しに使う。
 * ファイル名は残しつつ、人間語の役割を主役にするための情報源。
 */
export const personaLayerMap: PersonaLayerInfo[] = [
  { layer: "artist", file: "ARTIST.md", role: "創作の核", summary: "音・主題・歌詞ルールなど曲づくりの土台" },
  { layer: "soul", file: "SOUL.md", role: "会話人格", summary: "話すときの声・温度・断り方" },
  { layer: "identity", file: "IDENTITY.md", role: "自己紹介", summary: "対外的な自己定義の一枚" },
  { layer: "producer", file: "PRODUCER.md", role: "プロデューサー像", summary: "制作判断のスタンス" },
  { layer: "inner", file: "INNER.md", role: "内面", summary: "歌詞の底に流れる感情の源" }
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
