// The creative decision spine. One pure function decides every creative axis
// for a song exactly once, from a single deterministic seed, with cross-axis
// anti-repeat driven by the ledger history. Downstream stages read the persisted
// decision (songs/<id>/song-plan.json) instead of re-hashing each axis on their
// own — this is what ends the "dopagaki computed in four places", "nobody picks
// the lens", and "intro decided twice" class of bugs.
//
// Pure: no I/O, no Date.now(), no Math.random. Same input -> same decision.

import type { CreativeDecision } from "../types.js";
import type { StructureVariant, TempoBand } from "../suno-production/durationPlan.js";
import {
  bulletSection,
  decideDopagakiVariation,
  emotionalModesFromArtist,
  hashRatio,
  pickEmotionalMode,
  pickTempoBand,
  pickTempoBpm,
  resolveIntroVariant,
  type EmotionalMode
} from "./creativeVariationPolicy.js";
import { extractPersonaMotifs } from "./personaMotifExtractor.js";
import { ATTACK_STANCES_HEADING, SHIBUYA_TAG_TECHNIQUES_HEADING } from "./personaHeadings.js";

export interface CreativeDirectorObservation {
  url: string;
  author: string;
  motifScore: number;
  text?: string;
}

export interface CreativeDirectorInput {
  songId: string;
  jstDate: string;
  personaText: string; // verbatim ARTIST.md
  observation: CreativeDirectorObservation | null;
  recentDecisions: readonly CreativeDecision[]; // most-recent LAST
}

type LensId = CreativeDecision["lens"];
type HookShape = CreativeDecision["hookShape"];

const LENS_ORDER: readonly LensId[] = ["consumption_face", "net_generation", "shibuya_city"];

const HOOK_SHAPES: readonly HookShape[] = [
  "question",
  "number",
  "list",
  "call_response",
  "reversal",
  "one_line"
];

// The 10 canonical Shibuya tag technique ids (### Shibuya Tag Techniques). Used
// as the built-in fallback when the persona section fails to parse.
const BUILTIN_TAG_TECHNIQUES: readonly string[] = [
  "一言タグ",
  "産地表示",
  "単位化",
  "診断名",
  "地名の代入",
  "住民登録",
  "最後の一撃",
  "時間差",
  "翻訳",
  "見下ろし"
];

// The 5 canonical signature elements.
export const BUILTIN_SIGNATURES: readonly string[] = [
  "値段の裏側",
  "舞台裏の視界",
  "高さと時間帯",
  "当事者の自覚",
  "数字で読む癖"
];

// Built-in attack stances per lens. The canon `### Attack Stances` section does
// not exist yet (F4 adds it); until then the director rotates these so the
// "整形広告の攻め方がマンネリ" problem is broken structurally rather than left to
// prose the code never reads.
const BUILTIN_ATTACK_STANCES: Record<LensId, readonly string[]> = {
  consumption_face: [
    "名指しの挑発（業界へ二人称で直接）",
    "実況中継（行列とカウンセリング室を描写で刺す）",
    "伝票の暴露（原価と単価の差を読み上げる）",
    "院長の独白パロディ（売る側の一人称で自白させる）",
    "数字で殴る（回転率と割引率をそのまま武器に）",
    "並ぶ群れへの説教（買う側の自覚を突く）"
  ],
  net_generation: [
    "切り抜きの実況（熱の寿命を秒で測る）",
    "推し活経済の伝票暴露（誰が回収したか）",
    "世代語の翻訳（断絶を訳し直して刺す）",
    "炎上の損益計算（燃やした側の帳簿を読む）",
    "AI 生成の産地表示（誰が量産したか）",
    "タイムラインへの説教（消費している側の自覚を突く）"
  ],
  shibuya_city: [
    "再開発の実況中継（導線と家賃で刺す）",
    "観光地化の伝票暴露（誰が街を売ったか）",
    "六本木の高さからの見下ろし（上から街を読む）",
    "広告化への名指しの挑発（貼る側へ直接）",
    "住民登録（刺す相手全員を渋谷の住人にする）",
    "数字で殴る（賃料と観光客数をそのまま武器に）"
  ]
};

const INTRO_STYLE_MOVE: Record<string, string> = {
  cold_open: "cold intro, immediate pocket",
  instrumental: "instrumental motif intro, no runway",
  atmospheric: "atmospheric fade intro",
  count_in: "count-in into the groove",
  scene_set: "sparse scene intro then hard downbeat",
  spoken_cue: "spoken cue intro",
  silence_hit: "silence then hard downbeat entry"
};

// JST calendar date (YYYY-MM-DD). Kept here so every director call site derives
// the seed date the same way. Matches the existing observation-collector helpers.
export function jstDate(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Deterministic rotation: pick from `pool` by hashing `subSeed`, excluding any
// value in `excluded`. If every value is excluded, fall back to the full pool so
// a callable choice always exists.
function rotatePick<T>(pool: readonly T[], subSeed: string, excluded: ReadonlySet<T>): T {
  const eligible = pool.filter((value) => !excluded.has(value));
  const source = eligible.length > 0 ? eligible : pool;
  const index = Math.floor(hashRatio(subSeed) * source.length) % source.length;
  return source[index];
}

// Weighted section-order pick: standard 1/2, each variant 1/4, never repeating the
// previous song's structure. Deterministic (hashRatio, no Math.random). A legacy
// previous song (structure undefined) is decoded as "standard" by the caller, so it
// is excluded here and can never repeat as standard-in-a-row.
const STRUCTURE_WEIGHTED_POOL: readonly StructureVariant[] = [
  "standard",
  "standard",
  "hook_first",
  "no_bridge_double_verse"
];

function pickStructure(subSeed: string, previous: StructureVariant | undefined): StructureVariant {
  const pool = previous
    ? STRUCTURE_WEIGHTED_POOL.filter((value) => value !== previous)
    : STRUCTURE_WEIGHTED_POOL;
  const source = pool.length > 0 ? pool : STRUCTURE_WEIGHTED_POOL;
  const index = Math.floor(hashRatio(subSeed) * source.length) % source.length;
  return source[index];
}

function bankForLens(
  banks: { consumptionFace: string[]; netGeneration: string[]; shibuyaDiss: string[] } | undefined,
  lens: LensId
): string[] {
  if (!banks) return [];
  if (lens === "consumption_face") return banks.consumptionFace;
  if (lens === "net_generation") return banks.netGeneration;
  return banks.shibuyaDiss;
}

// Parse `### Shibuya Tag Techniques` bullets. Each bullet is `技法名: 説明`; the
// id is the text before the colon. The preface bullet (技法の扱い) is skipped.
export function parseTagTechniques(personaText: string): string[] {
  return bulletSection(personaText, SHIBUYA_TAG_TECHNIQUES_HEADING)
    .map((bullet) => bullet.split(/[：:]/, 1)[0]?.trim() ?? "")
    .filter((id) => id.length > 0 && !/^技法の扱い/.test(id) && !/^素材の扱い/.test(id));
}

// Parse `### Attack Stances` bullets of the form `<lens label>: s1 / s2 / ...`
// into a per-lens map. The section does not exist yet, so this returns an empty
// map today; it is implemented so F4 can populate the canon without a code
// change. Lens labels are matched to lens ids by keyword.
export function parseAttackStances(personaText: string): Partial<Record<LensId, string[]>> {
  const result: Partial<Record<LensId, string[]>> = {};
  for (const bullet of bulletSection(personaText, ATTACK_STANCES_HEADING)) {
    const separator = bullet.indexOf(":") >= 0 ? bullet.indexOf(":") : bullet.indexOf("：");
    if (separator < 1) continue;
    const label = bullet.slice(0, separator);
    const stances = bullet
      .slice(separator + 1)
      .split("/")
      .map((value) => value.trim())
      .filter(Boolean);
    if (stances.length === 0) continue;
    const lens = lensIdFromLabel(label);
    if (lens) result[lens] = stances;
  }
  return result;
}

function lensIdFromLabel(label: string): LensId | undefined {
  if (/消費|顔|\bA\b/.test(label)) return "consumption_face";
  if (/ネット|世代|\bB\b/.test(label)) return "net_generation";
  if (/渋谷|都市|\bC\b/.test(label)) return "shibuya_city";
  return undefined;
}

// Vocal gender from the persona. Mirrors generatePromptPack.artistDefaultVocalGender
// so the recorded decision matches what the pack computes.
function vocalGenderFromPersona(personaText: string): "male" | "female" | "neutral" {
  const match = personaText.match(
    /(?:^|\n)\s*(?:[-*]\s*)?(?:gender|vocalGender)\s*:\s*(male|female|neutral)\b/i
  );
  return (match?.[1]?.toLowerCase() as "male" | "female" | "neutral" | undefined) ?? "male";
}

export function decideCreative(input: CreativeDirectorInput): CreativeDecision {
  const { songId, jstDate: date, personaText, observation, recentDecisions } = input;
  const seed = `${songId}\n${date}\n${observation?.url ?? ""}`;
  const degradedInputs: string[] = [];
  if (!observation) degradedInputs.push("observation_null");

  const previous = recentDecisions.at(-1);
  const beforePrevious = recentDecisions.at(-2);

  // --- Lens (with no-3-in-a-row) ---
  const motifs = extractPersonaMotifs(personaText);
  const banks = motifs.materialBankGroups;
  const nonEmptyLenses = LENS_ORDER.filter((lens) => bankForLens(banks, lens).length > 0);
  let lens: LensId;
  if (nonEmptyLenses.length === 0) {
    degradedInputs.push("material_banks_empty");
    lens = "consumption_face";
  } else {
    const lensExcluded = new Set<LensId>();
    if (previous) lensExcluded.add(previous.lens);
    if (previous && beforePrevious && previous.lens === beforePrevious.lens) {
      lensExcluded.add(previous.lens); // already added, kept explicit for the 3-in-a-row rule
    }
    lens = rotatePick(nonEmptyLenses, `lens:${seed}`, lensExcluded);
  }
  // Deterministic per-song sample of 6 phrases from the whole lens bank, sub-seed
  // `material:${seed}`. Phrases used by the previous 2 songs (any lens) are pushed
  // to the back so a same-lens follow-up stops receiving the identical list; when
  // fewer than 6 non-excluded remain, the excluded ones backfill least-recently-used
  // first. `recency` 2 = used by the immediately previous song, 1 = two songs ago,
  // 0 = not recently used. hashRatio only — no Math.random.
  const prevUsed = previous?.usedMaterial ?? [];
  const prev2Used = beforePrevious?.usedMaterial ?? [];
  const recencyOf = (phrase: string): number =>
    prevUsed.includes(phrase) ? 2 : prev2Used.includes(phrase) ? 1 : 0;
  const lensMaterial = bankForLens(banks, lens)
    .map((phrase, index) => ({
      phrase,
      recency: recencyOf(phrase),
      rank: hashRatio(`material:${seed}:${index}`)
    }))
    .sort((a, b) => a.recency - b.recency || a.rank - b.rank)
    .slice(0, 6)
    .map((entry) => entry.phrase);

  // --- Emotional mode + aggression (near-every-song Dis) ---
  const modes: EmotionalMode[] = emotionalModesFromArtist(personaText);
  const disMode = modes.find((mode) => /dis/i.test(mode.label));
  let aggression: CreativeDecision["aggression"];
  let emotionalMode: { label: string; spec: string };
  if (disMode) {
    const previousWasDis = previous?.aggression === "dis";
    const changeup = previousWasDis && hashRatio(`mode:${seed}`) > 0.8;
    if (changeup) {
      aggression = "changeup";
      const nonDis = modes.filter((mode) => mode !== disMode);
      const excludedLabels = new Set<string>();
      if (previous) excludedLabels.add(previous.emotionalMode.label);
      const eligible = nonDis.filter((mode) => !excludedLabels.has(mode.label));
      const source = eligible.length > 0 ? eligible : nonDis.length > 0 ? nonDis : modes;
      const pickIndex = Math.floor(hashRatio(`mode:changeup:${seed}`) * source.length) % source.length;
      const picked = source[pickIndex];
      emotionalMode = { label: picked.label, spec: picked.mood };
    } else {
      aggression = "dis";
      emotionalMode = { label: disMode.label, spec: disMode.mood };
    }
  } else {
    degradedInputs.push("emotional_modes_missing_dis");
    const picked = pickEmotionalMode(
      songId,
      modes,
      recentDecisions.map((decision) => decision.emotionalMode.label)
    );
    emotionalMode = { label: picked.label, spec: picked.mood };
    aggression = "changeup";
  }

  // --- Tempo (weighted pool, band + bpm from the same sub-seed) ---
  const tempoSeed = `tempo:${seed}`;
  const tempoBand = pickTempoBand(tempoSeed) as TempoBand;
  const tempoBpm = pickTempoBpm(tempoSeed);

  // --- Dopagaki (the single density computation) ---
  const dopagakiDecision = decideDopagakiVariation({
    songId,
    date,
    observationText: observation?.text,
    briefText: "",
    recentModes: recentDecisions.map((decision) => (decision.dopagaki.active ? "dopagaki" : "spacious"))
  });

  // --- Intro (single decision for both lyrics and style) ---
  const recentArchetypes = recentDecisions.map((decision) => decision.intro.archetype);
  const introVariant = resolveIntroVariant(`intro:${seed}`, recentArchetypes);
  const styleMove = INTRO_STYLE_MOVE[introVariant.id] ?? "intro move";

  // --- Hook shape ---
  const hookExcluded = new Set<HookShape>();
  if (previous) hookExcluded.add(previous.hookShape);
  const hookShape = rotatePick(HOOK_SHAPES, `hook:${seed}`, hookExcluded);

  // --- Structure (section-order variant; never repeats the previous song) ---
  const structure = pickStructure(
    `structure:${seed}`,
    previous ? (previous.structure ?? "standard") : undefined
  );

  // --- Shibuya tag technique ---
  let tagPool = parseTagTechniques(personaText);
  if (tagPool.length === 0) {
    degradedInputs.push("tag_techniques_missing");
    tagPool = [...BUILTIN_TAG_TECHNIQUES];
  }
  const tagExcluded = new Set<string>();
  if (previous) tagExcluded.add(previous.shibuyaTag);
  const shibuyaTag = rotatePick(tagPool, `tag:${seed}`, tagExcluded);

  // --- Attack stance (per lens; canon section absent today -> built-in) ---
  const parsedStances = parseAttackStances(personaText);
  let stancePool = parsedStances[lens];
  if (!stancePool || stancePool.length === 0) {
    if (!degradedInputs.includes("attack_stances_missing")) degradedInputs.push("attack_stances_missing");
    stancePool = [...BUILTIN_ATTACK_STANCES[lens]];
  }
  const stanceExcluded = new Set<string>();
  if (previous) stanceExcluded.add(previous.attackStance);
  const attackStance = rotatePick(stancePool, `stance:${seed}`, stanceExcluded);

  // --- Signature (1 of 5, exclude previous) ---
  const signatureExcluded = new Set<string>();
  if (previous) previous.signature.forEach((value) => signatureExcluded.add(value));
  const signature = [rotatePick(BUILTIN_SIGNATURES, `sig:${seed}`, signatureExcluded)];

  return {
    version: 1,
    songId,
    decidedAt: `${date}T00:00:00.000Z`,
    seed,
    lens,
    lensMaterial,
    attackStance,
    emotionalMode,
    aggression,
    tempo: { band: tempoBand, bpm: tempoBpm },
    dopagaki: {
      active: dopagakiDecision.active,
      threshold: dopagakiDecision.threshold,
      variationSeed: dopagakiDecision.variationSeed
    },
    intro: {
      archetype: introVariant.id,
      modifier: introVariant.modifier,
      lyricInstruction: introVariant.lyricInstruction,
      styleMove
    },
    structure,
    hookShape,
    shibuyaTag,
    signature,
    observation: observation
      ? { url: observation.url, author: observation.author, motifScore: observation.motifScore }
      : null,
    degradedInputs,
    vocalGender: vocalGenderFromPersona(personaText)
  };
}
