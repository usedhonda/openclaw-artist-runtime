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
  parseCritiqueLenses,
  parseSignatures,
  pickEmotionalMode,
  bpmForTempoBand,
  pickTempoBandAvoidingSlowRepeat,
  resolveIntroVariant,
  type EmotionalMode,
  type PersonaLens
} from "./creativeVariationPolicy.js";
import { extractPersonaMotifs } from "./personaMotifExtractor.js";
import { ATTACK_STANCES_HEADING, CATCHPHRASES_HEADING, TAG_TECHNIQUES_HEADING } from "./personaHeadings.js";

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

const HOOK_SHAPES: readonly HookShape[] = [
  "question",
  "number",
  "list",
  "call_response",
  "reversal",
  "one_line"
];

// The artist's recurring catchphrases. Budgeted per song (a catchphrase used in
// the previous song is banned in the next) so a recurring hook line stops
// appearing in every track. Aliases collapse spelling variants to one id.
// Persona-declared specs come from `### Catchphrases`; `same_same` (a shape —
// "same X, same Y" — caught by regex, not by alias) is the one catchphrase the
// code always knows regardless of persona, because the shape itself is not
// artist-specific.
export interface CatchphraseSpec {
  id: string;
  label: string; // display name for the prompt directive
  aliases: readonly string[]; // exact substrings; any match records the id
  regex?: RegExp; // optional shape match (no /g so .test is stateless)
}

const SAME_SAME_CATCHPHRASE: CatchphraseSpec = {
  id: "same_same",
  label: "same X, same Y の定型",
  aliases: [],
  regex: /\bsame\s+\w+,\s*same\s+\w+/i
};

// Parse `### Catchphrases` bullets of the form `- id: form1, form2, ...` into
// specs, then append the built-in shape catchphrase. The first form becomes the
// display label; every form is an alias any of which marks the id "used".
export function parseCatchphrases(personaText: string): CatchphraseSpec[] {
  const specs: CatchphraseSpec[] = [];
  for (const bullet of bulletSection(personaText, CATCHPHRASES_HEADING)) {
    const separator = bullet.search(/[:：]/);
    if (separator < 1) continue;
    const id = bullet.slice(0, separator).trim();
    const forms = bullet
      .slice(separator + 1)
      .split(/[,、]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!id || forms.length === 0) continue;
    specs.push({ id, label: forms[0], aliases: forms });
  }
  return [...specs, SAME_SAME_CATCHPHRASE];
}

// The catchphrase ids that appear in `lyrics` (exact alias match or the shape
// regex). Deterministic, AI-free; input order preserved. Reused by the ledger
// writer to record usedCatchphrases and by the director indirectly via that.
export function detectCatchphrases(personaText: string, lyrics: string): string[] {
  const ids: string[] = [];
  for (const spec of parseCatchphrases(personaText)) {
    const hit = spec.aliases.some((alias) => lyrics.includes(alias)) || (spec.regex?.test(lyrics) ?? false);
    if (hit) ids.push(spec.id);
  }
  return ids;
}

// Display name for a catchphrase id, for the prompt directive. Unknown ids fall
// back to the id itself so a stale ledger value never renders blank.
export function catchphraseLabel(personaText: string, id: string): string {
  return parseCatchphrases(personaText).find((spec) => spec.id === id)?.label ?? id;
}

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

function bankForLens(banks: Record<string, string[]> | undefined, lens: LensId): string[] {
  if (!banks || !lens) return [];
  return banks[lens] ?? [];
}

// Parse `### Tag Techniques` bullets. Each bullet is `技法名: 説明` (or the
// persona's own language equivalent); the id is the text before the colon. An
// optional leading preamble bullet (`技法の扱い...` / `素材の扱い...`) is skipped,
// same as the material banks' preface convention.
export function parseTagTechniques(personaText: string): string[] {
  return bulletSection(personaText, TAG_TECHNIQUES_HEADING)
    .map((bullet) => bullet.split(/[：:]/, 1)[0]?.trim() ?? "")
    .filter((id) => id.length > 0 && !/^技法の扱い/.test(id) && !/^素材の扱い/.test(id));
}

// Parse `### Attack Stances` bullets of the form `[lens_id]: s1 / s2 / ...` into
// a per-lens map. A preamble bullet without a bracketed id (e.g. "刺し方を毎曲変
// える") is allowed and ignored, same convention as the Critique Lens section.
export function parseAttackStances(personaText: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const bullet of bulletSection(personaText, ATTACK_STANCES_HEADING)) {
    const match = /^\[([a-z0-9_]+)\]\s*[:：]\s*(.+)$/.exec(bullet.trim());
    if (!match) continue;
    const [, lensId, rest] = match;
    const stances = rest
      .split("/")
      .map((value) => value.trim())
      .filter(Boolean);
    if (stances.length > 0) result[lensId] = stances;
  }
  return result;
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
  // Lens ids come entirely from the persona's own `### Critique Lens` roster —
  // there is no code-level lens list any more. When the persona declares none,
  // the director cannot invent one; it records the degradation and leaves lens
  // (and everything derived from it) empty rather than fabricating content.
  const lenses: PersonaLens[] = parseCritiqueLenses(personaText);
  const lensIds = lenses.map((entry) => entry.id);
  const motifs = extractPersonaMotifs(personaText);
  const banks = motifs.materialBankGroups;
  const lensesWithMaterial = lensIds.filter((id) => bankForLens(banks, id).length > 0);
  let lens: LensId;
  if (lensIds.length === 0) {
    degradedInputs.push("lens_missing");
    lens = "";
  } else {
    if (lensesWithMaterial.length === 0) degradedInputs.push("material_banks_empty");
    const candidates = lensesWithMaterial.length > 0 ? lensesWithMaterial : lensIds;
    const lensExcluded = new Set<LensId>();
    if (previous) lensExcluded.add(previous.lens);
    if (previous && beforePrevious && previous.lens === beforePrevious.lens) {
      lensExcluded.add(previous.lens); // already added, kept explicit for the 3-in-a-row rule
    }
    lens = rotatePick(candidates, `lens:${seed}`, lensExcluded);
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

  // --- Tempo (weighted pool, band from the sub-seed, bpm from the duration plan) ---
  // The slow half of the range never lands twice in a row: every other axis avoids
  // an immediate repeat, and a run of mellow songs is exactly what the producer
  // notices. The bpm is read from the band so the plan and the pack cannot disagree.
  const tempoSeed = `tempo:${seed}`;
  const tempoBand = pickTempoBandAvoidingSlowRepeat(tempoSeed, previous?.tempo.band) as TempoBand;
  const tempoBpm = bpmForTempoBand(tempoBand);

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

  // --- Hook shape ---
  const hookExcluded = new Set<HookShape>();
  if (previous) hookExcluded.add(previous.hookShape);
  const hookShape = rotatePick(HOOK_SHAPES, `hook:${seed}`, hookExcluded);

  // --- Structure (section-order variant; never repeats the previous song) ---
  const structure = pickStructure(
    `structure:${seed}`,
    previous ? (previous.structure ?? "standard") : undefined
  );

  // --- Tag technique ---
  // No built-in fallback pool: when the persona's `### Tag Techniques` section is
  // empty, the director records the degradation and leaves the axis empty rather
  // than inventing technique names.
  const tagPool = parseTagTechniques(personaText);
  let tagTechnique: string;
  if (tagPool.length === 0) {
    degradedInputs.push("tag_techniques_missing");
    tagTechnique = "";
  } else {
    const tagExcluded = new Set<string>();
    if (previous) tagExcluded.add(previous.tagTechnique);
    tagTechnique = rotatePick(tagPool, `tag:${seed}`, tagExcluded);
  }

  // --- Attack stance (per lens) ---
  // No built-in fallback: when the chosen lens has no stances declared under
  // `### Attack Stances`, the director records the degradation and leaves the
  // axis empty.
  const parsedStances = parseAttackStances(personaText);
  const stancePool = lens ? (parsedStances[lens] ?? []) : [];
  let attackStance: string;
  if (stancePool.length === 0) {
    degradedInputs.push("attack_stances_missing");
    attackStance = "";
  } else {
    const stanceExcluded = new Set<string>();
    if (previous) stanceExcluded.add(previous.attackStance);
    attackStance = rotatePick(stancePool, `stance:${seed}`, stanceExcluded);
  }

  // --- Catchphrase budget (ban the previous song's catchphrase ids) ---
  // parseCatchphrases always returns at least the built-in same_same shape spec;
  // when the persona declares none of its own, that is recorded as a degradation
  // rather than silently running the budget over one code-level entry.
  const catchphraseSpecs = parseCatchphrases(personaText);
  if (catchphraseSpecs.length <= 1) degradedInputs.push("catchphrases_missing");
  const catchphraseIds = catchphraseSpecs.map((spec) => spec.id);
  const previousCatchphrases = previous?.usedCatchphrases ?? [];
  const bannedCatchphrases = catchphraseIds.filter((id) => previousCatchphrases.includes(id));
  const allowedCatchphrases = catchphraseIds.filter((id) => !bannedCatchphrases.includes(id));

  // --- Signature (1 of N declared, exclude previous) ---
  // No built-in fallback: when the persona has no `- Signature: ...` bullet, the
  // director records the degradation and leaves the axis empty.
  const signaturePool = parseSignatures(personaText);
  let signature: string[];
  if (signaturePool.length === 0) {
    degradedInputs.push("signature_missing");
    signature = [];
  } else {
    const signatureExcluded = new Set<string>();
    if (previous) previous.signature.forEach((value) => signatureExcluded.add(value));
    signature = [rotatePick(signaturePool, `sig:${seed}`, signatureExcluded)];
  }

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
      styleMove: introVariant.styleMove
    },
    structure,
    hookShape,
    tagTechnique,
    catchphraseBudget: { allowed: allowedCatchphrases, banned: bannedCatchphrases },
    signature,
    observation: observation
      ? { url: observation.url, author: observation.author, motifScore: observation.motifScore }
      : null,
    degradedInputs,
    vocalGender: vocalGenderFromPersona(personaText)
  };
}
