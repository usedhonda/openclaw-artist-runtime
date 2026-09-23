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
  legacyAliases?: string[];
  owner: PersonaCanonicalOwner;
  uiExposure: PersonaCanonicalUiExposure;
  label: string;
  help: string;
  derivedOutputs: PersonaTemplateFile[];
  forbiddenFiles: PersonaTemplateFile[];
  setupEditable: boolean;
  setupRequired: boolean;
  aiProposable: boolean;
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
    legacyAliases: ["artistName", "artist name", "name"],
    setupEditable: false,
    setupRequired: false,
    aiProposable: false
  },
  {
    id: "producerCallname",
    owner: { kind: "config", path: "artist.identity.producerCallname" },
    uiExposure: "derived",
    label: "プロデューサー呼称",
    help: "会話で producer を呼ぶ名前。MD には手入力しません。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["ARTIST.md", "SOUL.md", "PRODUCER.md", "INNER.md"],
    legacyAliases: ["producerCallname", "producer callname", "callname"],
    setupEditable: false,
    setupRequired: false,
    aiProposable: false
  },
  {
    id: "artistConcept",
    legacyField: "identityLine",
    legacyAliases: ["identityLine", "identity", "manifesto", "artist concept"],
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "アーティストコンセプト",
    help: "名前ではなく、何に取り憑かれて何を歌う存在か。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    setupRequired: true,
    aiProposable: true,
    multiline: true,
    minLength: 8
  },
  {
    id: "soundDna",
    legacyAliases: ["soundDna", "sound", "sound dna"],
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "音の核",
    help: "Suno Style と曲調に効く音の核。具体的な質感・楽器・BPM まで書く。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    setupRequired: true,
    aiProposable: true,
    multiline: true,
    minLength: 20
  },
  {
    id: "obsessions",
    legacyAliases: ["obsessions", "themes", "theme"],
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "執着テーマ",
    help: "繰り返し拾う主題。観察・曲提案・歌詞の選び方に効く。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    setupRequired: true,
    aiProposable: true,
    multiline: true,
    minLength: 20
  },
  {
    id: "lyricsRules",
    legacyAliases: ["lyricsRules", "lyrics", "lyrics rule", "lyrics rules"],
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "歌詞スタンス",
    help: "歌詞で守る制約。言語・避ける語・構造・比喩の癖。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    setupRequired: true,
    aiProposable: true,
    multiline: true,
    minLength: 20
  },
  {
    id: "socialVoice",
    legacyAliases: ["socialVoice", "social voice", "voice"],
    owner: { kind: "file", file: "ARTIST.md" },
    uiExposure: "user_input",
    label: "公開/SNS の声",
    help: "公開投稿や短い制作ノートの声。会話人格とは分ける。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["SOUL.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    setupRequired: true,
    aiProposable: true,
    multiline: true,
    minLength: 20
  },
  {
    id: "conversationTone",
    legacyField: "soul-tone",
    legacyAliases: ["soul-tone", "soul tone", "conversation tone", "tone"],
    owner: { kind: "file", file: "SOUL.md" },
    uiExposure: "user_input",
    label: "会話の温度",
    help: "Telegram などで producer と話す距離感・速度・荒さ。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["ARTIST.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    setupRequired: true,
    aiProposable: true,
    multiline: true,
    minLength: 5
  },
  {
    id: "refusalStyle",
    legacyField: "soul-refusal",
    legacyAliases: ["soul-refusal", "soul refusal", "refusal style", "refusal"],
    owner: { kind: "file", file: "SOUL.md" },
    uiExposure: "user_input",
    label: "断り方",
    help: "弱い案・危ない案をどう止め、何を代わりに出すか。",
    derivedOutputs: ["IDENTITY.md"],
    forbiddenFiles: ["ARTIST.md", "PRODUCER.md", "INNER.md"],
    setupEditable: true,
    setupRequired: true,
    aiProposable: true,
    multiline: true,
    minLength: 8
  },
  {
    id: "producerFacts",
    legacyAliases: ["producerFacts", "producer facts", "producer context", "producer memo"],
    owner: { kind: "file", file: "PRODUCER.md" },
    uiExposure: "user_input",
    label: "制作判断に効く producer 事実",
    help: "好み・境界・判断材料だけ。呼称や artist voice は置かない。",
    derivedOutputs: [],
    forbiddenFiles: ["ARTIST.md", "SOUL.md", "INNER.md"],
    setupEditable: true,
    setupRequired: false,
    aiProposable: true,
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
    setupRequired: false,
    aiProposable: false,
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

export function personaCanonicalTarget(field: PersonaCanonicalField): string {
  return field.owner.kind === "file" ? field.owner.file : field.owner.path;
}

export function personaCanonicalLegacyKey(field: PersonaCanonicalField): string {
  return field.legacyField ?? field.id;
}

export function personaSetupEditableFields(): PersonaCanonicalField[] {
  return personaCanonicalFields.filter((field) => field.setupEditable);
}

export function personaAiProposableFields(): PersonaCanonicalField[] {
  return personaCanonicalFields.filter((field) => field.aiProposable);
}

function normalizeAlias(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

export function personaCanonicalFieldFromAlias(value: string): PersonaCanonicalField | undefined {
  const normalized = normalizeAlias(value);
  return personaCanonicalFields.find((field) =>
    normalizeAlias(field.id) === normalized ||
    (field.legacyField ? normalizeAlias(field.legacyField) === normalized : false) ||
    (field.legacyAliases ?? []).some((alias) => normalizeAlias(alias) === normalized)
  );
}

export function personaCanonicalLegacyFields(options: { setupEditableOnly?: boolean; aiProposableOnly?: boolean } = {}): string[] {
  return personaCanonicalFields
    .filter((field) => !options.setupEditableOnly || field.setupEditable)
    .filter((field) => !options.aiProposableOnly || field.aiProposable)
    .map(personaCanonicalLegacyKey);
}

export function personaCanonicalTargetForAlias(value: string): string | undefined {
  const field = personaCanonicalFieldFromAlias(value);
  return field ? personaCanonicalTarget(field) : undefined;
}

export const personaFileContracts = {
  "ARTIST.md": {
    owns: "artist concept, obsessions, sound anchors, lyric constraints, public/social output voice, and Suno production traits",
    uiKind: "入力",
    uiRequirement: "必須",
    uiSummary: "曲を作る時の核。何に惹かれ、どんな音で、どんな歌詞を書くか。",
    uiPurpose: "曲の題材、音の方向、歌詞の癖、公開投稿の声を決める。Suno prompt と日々の曲案に一番強く効く。",
    uiWrite: "テーマ、音の質感、歌詞の制約、公開投稿の声、Suno に渡す音楽的特徴。",
    uiAvoid: "アーティスト名、producer の情報、会話口調、内部メモ。",
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
    uiKind: "入力",
    uiRequirement: "必須",
    uiSummary: "あなたと話す時の声。制作相談、報告、断り方の温度を決める。",
    uiPurpose: "producer への返事、相談時の距離感、弱い案を止める態度を決める。曲のジャンルや音色はここでは決めない。",
    uiWrite: "会話の距離感、言い回し、弱い案を止める時の態度。",
    uiAvoid: "音楽ジャンル、Suno 設定、producer 呼称、artist のプロフィール。",
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
    uiKind: "自動",
    uiRequirement: "編集不可",
    uiSummary: "名前と入力内容から作る確認用プロフィール。正本ではない。",
    uiPurpose: "設定済みの名前と入力内容を束ねた表示用プロフィール。確認用であり、ここに新しいルールを書いても正本にはならない。",
    uiWrite: "ユーザーは書かない。runtime が config、ARTIST.md、SOUL.md から表示する。",
    uiAvoid: "新しい設定、制作ルール、個人情報。",
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
    uiKind: "内部",
    uiRequirement: "編集不可",
    uiSummary: "runtime が扱う内面メモ。Setup の入力欄ではない。",
    uiPurpose: "制作履歴や内部の揺れを runtime が持ち越す場所。ユーザーが初期設定で埋めるファイルではなく、公開プロフィールにも使わない。",
    uiWrite: "通常はユーザーが書かない。既存内容は seed/history として保持する。",
    uiAvoid: "Setup 入力、公開プロフィール、producer 情報。",
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
    uiKind: "入力",
    uiRequirement: "任意",
    uiSummary: "制作判断に効く producer 側の好み・制約・境界だけを書く。",
    uiPurpose: "producer の好み、避けたい方向、公開前の境界を決める。任意なので空でも setup 完了は止めない。",
    uiWrite: "避けたい方向、好きな密度、公開前に確認したい境界、判断材料。",
    uiAvoid: "住所、連絡先、実名詳細、秘密情報、artist の声や音楽性。",
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
