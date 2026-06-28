export const personaCanonicalVersion = 1;

export const artistManagedSections = [
  "Artist Concept",
  "Current Artist Core",
  "Sound",
  "Lyrics",
  "Social Voice",
  "Suno Production Profile"
] as const;

export const soulManagedSections = ["Telegram Persona Voice"] as const;

export type PersonaCanonicalOwner =
  | { kind: "config"; path: "artist.identity.displayName" | "artist.identity.producerCallname" }
  | { kind: "file"; file: PersonaTemplateFile };

export type PersonaCanonicalFieldId =
  | "artistDisplayName"
  | "producerCallname"
  | "artistConcept"
  | "soundDna"
  | "obsessions"
  | "lyricsRules"
  | "socialVoice"
  | "conversationTone"
  | "refusalStyle"
  | "producerFacts"
  | "privateTensions";

export type PersonaCanonicalUiExposure = "user_input" | "derived" | "internal";

export interface PersonaCanonicalField {
  id: PersonaCanonicalFieldId;
  legacyField?: string;
  owner: PersonaCanonicalOwner;
  uiExposure: PersonaCanonicalUiExposure;
  label: string;
  help: string;
  derivedOutputs: PersonaTemplateFile[];
  forbiddenFiles: PersonaTemplateFile[];
  setupEditable: boolean;
  multiline?: boolean;
  minLength?: number;
}

export const personaCanonicalFields: PersonaCanonicalField[] = [
  {
    id: "artistDisplayName",
    legacyField: "artistName",
    owner: { kind: "config", path: "artist.identity.displayName" },
    uiExposure: "derived",
    label: "アーティスト表示名",
    help: "全曲・公開プロフィールで使う名前。MD には手入力しません。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["ARTIST.md", "SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: false
  },
  {
    id: "producerCallname",
    owner: { kind: "config", path: "artist.identity.producerCallname" },
    uiExposure: "derived",
    label: "プロデューサー呼称",
    help: "会話で producer を呼ぶ名前。MD には手入力しません。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["ARTIST.md", "SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: false
  },
  {
    id: "artistConcept",
    legacyField: "identityLine",
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "アーティストコンセプト",
    help: "名前ではなく、何に取り憑かれて何を歌う存在か。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    multiline: true,
    minLength: 8
  },
  {
    id: "soundDna",
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "音の核",
    help: "Suno Style と曲調に効く音の核。具体的な質感・楽器・BPM まで書く。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    multiline: true,
    minLength: 20
  },
  {
    id: "obsessions",
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "執着テーマ",
    help: "繰り返し拾う主題。観察・曲提案・歌詞の選び方に効く。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    multiline: true,
    minLength: 20
  },
  {
    id: "lyricsRules",
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "歌詞スタンス",
    help: "歌詞で守る制約。言語・避ける語・構造・比喩の癖。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    multiline: true,
    minLength: 20
  },
  {
    id: "socialVoice",
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "公開/SNS の声",
    help: "公開投稿や短い制作ノートの声。会話人格とは分ける。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    multiline: true,
    minLength: 20
  },
  {
    id: "conversationTone",
    legacyField: "soul-tone",
    owner: { kind: "file", file: "SOUL.md" },
    uiExposure: "user_input",
    label: "会話の温度",
    help: "Telegram などで producer と話す距離感・速度・荒さ。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["ARTIST.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    multiline: true,
    minLength: 5
  },
  {
    id: "refusalStyle",
    legacyField: "soul-refusal",
    owner: { kind: "file", file: "SOUL.md" },
    uiExposure: "user_input",
    label: "断り方",
    help: "弱い案・危ない案をどう止め、何を代わりに出すか。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["ARTIST.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    multiline: true,
    minLength: 8
  },
  {
    id: "producerFacts",
    owner: { kind: "file", file: "PRODUCER.md" },
    uiExposure: "user_input",
    label: "制作判断に効く producer 事実",
    help: "好み・境界・判断材料だけ。呼称や artist voice は置かない。",
    derivedOutputs: [],
    forbiddenFiles: ["ARTIST.md", "SOUL.md", "INNER.md"],
    setupEditable: true,
    multiline: true,
    minLength: 0
  },
  {
    id: "privateTensions",
    owner: { kind: "file", file: "INNER.md" },
    uiExposure: "internal",
    label: "表に出ない創作圧",
    help: "runtime が seed/history から管理する内部圧。Setup 入力には出しません。",
    derivedOutputs: [],
    forbiddenFiles: ["ARTIST.md", "SOUL.md", "PRODUCER.md"],
    setupEditable: false,
    multiline: true,
    minLength: 0
  }
] as const;

export function personaCanonicalField(id: PersonaCanonicalFieldId): PersonaCanonicalField {
  const field = personaCanonicalFields.find((candidate) => candidate.id === id);
  if (!field) {
    throw new Error(`unknown_persona_canonical_field:${id}`);
  }
  return field;
}

export function personaCanonicalOwnerCount(id: PersonaCanonicalFieldId): number {
  return personaCanonicalFields.filter((field) => field.id === id).length;
}

export const personaFileContracts = {
  "ARTIST.md": {
    owns: "artist concept, obsessions, sound anchors, lyric constraints, public/social output voice, and Suno production traits",
    forbidden: [
      "artist name",
      "display name",
      "producer relationship",
      "producer identity",
      "producer callname",
      "producer facts",
      "private weather",
      "what i fear",
      "telegram persona voice",
      "conversation tone",
      "refusal style"
    ]
  },
  "SOUL.md": {
    owns: "direct speaking style: conversation tone, refusal style, sentence endings, forbidden phrases, and signature moves",
    forbidden: [
      "artist name",
      "display name",
      "producer callname",
      "suno production profile",
      "genre dna",
      "sonic anchors",
      "producer identity",
      "private weather",
      "what i fear"
    ]
  },
  "IDENTITY.md": {
    owns: "derived identity card from config identity, ARTIST.md, and SOUL.md; no new setup facts",
    forbidden: [
      "genre dna",
      "core obsessions",
      "producer identity",
      "private weather",
      "conversation tone",
      "suno production profile"
    ]
  },
  "INNER.md": {
    owns: "runtime-managed private creative pressure and internal history; not a setup input",
    forbidden: [
      "artist name",
      "suno production profile",
      "producer identity",
      "conversation tone",
      "genre dna",
      "social voice"
    ]
  },
  "PRODUCER.md": {
    owns: "producer-specific facts that change response or decisions",
    forbidden: [
      "artist name",
      "genre dna",
      "suno production profile",
      "conversation tone",
      "private weather",
      "voice fingerprint"
    ]
  }
} as const;

export type PersonaTemplateFile = keyof typeof personaFileContracts;
