/**
 * voiceFingerprintParser — Plan v10.10 Phase A
 *
 * SOUL.md 11 section schema を読み取って、artist の voice fingerprint を
 * 構造化バンドルとして返す parser。Phase B (composer 拘束)、Phase C (Voice
 * Contract AI prompt)、Phase G (contract test) で共有される。
 *
 * 御大手書きの自由文 (My Heart / Internal Tensions / Producer relationship 等)
 * は string そのまま、構造化部分 (forbidden_phrases / sentence_endings 等) は
 * list として抽出する。
 *
 * fail-closed の判定は isVoiceFingerprintReady で別 export。
 */

export interface VoiceFingerprintBundle {
  manifesto: string | null;
  myHeart: string;
  coreTruths: string[];
  internalTensions: string;
  boundaries: string[];
  priorityOrder: string[];
  whenIFail: string[];
  whatImNot: string;
  vibe: string;
  signatureMoves: string[];
  forbiddenPhrases: string[];
  sentenceEndings: string[];
  reactionPhrases: string[];
  producerRelationship: string;
  producerCallname: string | null;
  firstPerson: string | null;
  productionVoiceContexts: string;
  continuity: string;
}

export interface VoiceFingerprintReadiness {
  ok: boolean;
  missing: string[];
}

const TBD_LIKE = /(^|\s)TBD($|\s|\.|。)/;

function stripCommentBlocks(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function getSection(soulMd: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`^##\\s+${escaped}(?:\\s|\\(|$)`);
  const lines = soulMd.split(/\r?\n/);
  const collected: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (inside) {
      if (/^##\s+/.test(line) && !/^###\s+/.test(line)) break;
      collected.push(line);
    } else if (startRe.test(line)) {
      inside = true;
    }
  }
  return collected.join("\n").trim();
}

function getSubsection(sectionBody: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startRe = new RegExp(`^###\\s+${escaped}(?:\\s|\\(|$)`);
  const lines = sectionBody.split(/\r?\n/);
  const collected: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (inside) {
      if (/^###\s+/.test(line) || /^##\s+/.test(line)) break;
      collected.push(line);
    } else if (startRe.test(line)) {
      inside = true;
    }
  }
  return collected.join("\n").trim();
}

function extractListItems(body: string): string[] {
  const stripped = stripCommentBlocks(body);
  return stripped
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .map((item) => item.replace(/^"(.+)"$/, "$1"))
    .filter((item) => item.length > 0)
    .filter((item) => !TBD_LIKE.test(item));
}

function extractManifesto(soulMd: string): string | null {
  const cleaned = stripCommentBlocks(soulMd);
  const m = cleaned.match(/^_(.+?)_\s*$/m);
  if (!m) return null;
  const text = m[1].trim();
  return TBD_LIKE.test(text) ? null : text;
}

function extractCoreTruths(body: string): string[] {
  const stripped = stripCommentBlocks(body);
  const truths: string[] = [];
  const re = /^###\s+\d+\.\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    const heading = match[1].trim();
    if (TBD_LIKE.test(heading)) continue;
    truths.push(heading);
  }
  return truths;
}

function extractPriorityOrder(boundariesBody: string): string[] {
  const stripped = stripCommentBlocks(boundariesBody);
  const m = stripped.match(/\*\*優先順位\*\*\s*[:：]\s*(.+)/);
  if (!m) return [];
  return m[1]
    .split(/[>＞]/)
    .map((s) => s.trim())
    .map((s) => s.replace(/[（(].*[)）]\s*$/, "").trim())
    .filter((s) => s.length > 0)
    .filter((s) => !TBD_LIKE.test(s));
}

function extractKeyValue(body: string, key: string): string | null {
  const stripped = stripCommentBlocks(body);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`-\\s*\\*?\\*?${escaped}\\*?\\*?\\s*[:：]\\s*(.+)`, "m");
  const match = stripped.match(re);
  if (!match) return null;
  const value = match[1].trim().replace(/^"(.+)"$/, "$1").trim();
  return TBD_LIKE.test(value) ? null : value;
}

export function parseVoiceFingerprint(soulMd: string): VoiceFingerprintBundle {
  const myHeart = stripCommentBlocks(getSection(soulMd, "My Heart")).trim();
  const coreTruthsBody = getSection(soulMd, "Core Truths");
  const internalTensions = stripCommentBlocks(getSection(soulMd, "Internal Tensions")).trim();
  const boundariesBody = getSection(soulMd, "Boundaries");
  const whenIFail = extractListItems(getSection(soulMd, "When I Fail"));
  const whatImNot = stripCommentBlocks(getSection(soulMd, "What I'm Not")).trim();
  const vibeBody = getSection(soulMd, "The Vibe");
  const variationRuleBody = getSection(soulMd, "文体 variation rule");
  const producerRelationshipBody = getSection(soulMd, "Producer (relationship in music-making)");
  const productionVoiceContexts = stripCommentBlocks(getSection(soulMd, "Production Voice Contexts")).trim();
  const continuity = stripCommentBlocks(getSection(soulMd, "Continuity")).trim();

  const signatureMoves = extractListItems(getSubsection(vibeBody, "Signature Moves"));
  const forbiddenPhrases = extractListItems(getSubsection(variationRuleBody, "forbidden_phrases"));
  const sentenceEndings = extractListItems(getSubsection(variationRuleBody, "sentence_endings"));
  const reactionPhrases = extractListItems(getSubsection(variationRuleBody, "reaction_phrases"));
  const producerCallSubsection = getSubsection(producerRelationshipBody, "Producer call");
  const producerCallname = extractKeyValue(producerCallSubsection, "producer_callname");
  const firstPerson = extractKeyValue(producerCallSubsection, "first_person");

  const boundariesList = extractListItems(boundariesBody);
  const priorityOrder = extractPriorityOrder(boundariesBody);

  const vibeFreeText = vibeBody
    .split(/^###\s+/m)[0]
    .trim();

  const producerRelationshipText = producerRelationshipBody
    .split(/^###\s+/m)[0]
    .trim();

  return {
    manifesto: extractManifesto(soulMd),
    myHeart,
    coreTruths: extractCoreTruths(coreTruthsBody),
    internalTensions,
    boundaries: boundariesList,
    priorityOrder,
    whenIFail,
    whatImNot,
    vibe: vibeFreeText,
    signatureMoves,
    forbiddenPhrases,
    sentenceEndings,
    reactionPhrases,
    producerRelationship: producerRelationshipText,
    producerCallname,
    firstPerson,
    productionVoiceContexts,
    continuity
  };
}

const REQUIRED_FIELDS: { key: keyof VoiceFingerprintBundle; minLength?: number }[] = [
  { key: "manifesto" },
  { key: "myHeart", minLength: 80 },
  { key: "coreTruths" },
  { key: "internalTensions", minLength: 80 },
  { key: "boundaries" },
  { key: "priorityOrder" },
  { key: "whatImNot", minLength: 40 },
  { key: "signatureMoves" },
  { key: "forbiddenPhrases" },
  { key: "sentenceEndings" },
  { key: "producerRelationship", minLength: 60 },
  { key: "producerCallname" },
  { key: "firstPerson" }
];

export function isVoiceFingerprintReady(bundle: VoiceFingerprintBundle): VoiceFingerprintReadiness {
  const missing: string[] = [];
  for (const spec of REQUIRED_FIELDS) {
    const value = bundle[spec.key];
    if (value === null) {
      missing.push(spec.key);
      continue;
    }
    if (typeof value === "string") {
      const text = value.trim();
      if (text.length === 0 || TBD_LIKE.test(text)) {
        missing.push(spec.key);
        continue;
      }
      if (spec.minLength !== undefined && text.length < spec.minLength) {
        missing.push(spec.key);
      }
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        missing.push(spec.key);
      }
    }
  }
  return { ok: missing.length === 0, missing };
}

export function summarizeFingerprint(bundle: VoiceFingerprintBundle): string {
  const lines: string[] = [];
  if (bundle.producerCallname) lines.push(`producer_callname: ${bundle.producerCallname}`);
  if (bundle.firstPerson) lines.push(`first_person: ${bundle.firstPerson}`);
  if (bundle.sentenceEndings.length) lines.push(`sentence_endings: ${bundle.sentenceEndings.slice(0, 6).join(" / ")}`);
  if (bundle.forbiddenPhrases.length) {
    lines.push(`forbidden (sample): ${bundle.forbiddenPhrases.slice(0, 4).map((p) => `"${p}"`).join(", ")}`);
  }
  if (bundle.signatureMoves.length) {
    lines.push(`signature sample: "${bundle.signatureMoves[0]}"`);
  }
  return lines.join("\n");
}
