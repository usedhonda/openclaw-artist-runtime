// Persona contract doctor. A safety net for the class of failure where the live
// ARTIST.md silently stops parsing into what the creative pipeline needs — a
// renamed heading, a gutted section, a fallback that quietly takes over. The
// doctor runs the REAL parsers the pipeline uses (never a reimplementation) and
// loudly reports every check that no longer holds, so "the persona degraded and
// nobody noticed" cannot happen again.

import { extractPersonaMotifs } from "./personaMotifExtractor.js";
import { bulletSection, emotionalModesFromArtist } from "./creativeVariationPolicy.js";
import { critiqueLensLines } from "./creativeVariationPolicy.js";
import { BUILTIN_SIGNATURES, parseAttackStances, parseTagTechniques } from "./creativeDirector.js";
import { CRITIQUE_LENS_HEADING } from "./personaHeadings.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";

export interface PersonaContractCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface PersonaContractReport {
  ok: boolean;
  checks: PersonaContractCheck[];
  degraded: string[];
}

// The three lenses the material banks and attack stances must cover. Kept local
// so the doctor does not depend on creativeDirector's private LensId literals.
const LENS_LABELS: Array<{ id: "consumption_face" | "net_generation" | "shibuya_city"; label: string }> = [
  { id: "consumption_face", label: "A 消費と顔" },
  { id: "net_generation", label: "B ネットと世代" },
  { id: "shibuya_city", label: "C 渋谷と都市" }
];

// Pure: no I/O, no memo, no emit. Given the persona text, run the real parsers
// and return which contracts hold. Callers that want the "notify once" behavior
// use diagnoseAndReportPersonaContract below.
export function diagnosePersonaContract(personaText: string): PersonaContractReport {
  const checks: PersonaContractCheck[] = [];

  // 1. Material banks — extractPersonaMotifs is what the director reads to pick a
  // lens and its material. All three banks must be non-empty or the lens
  // rotation collapses onto whichever bank survived.
  const banks = extractPersonaMotifs(personaText).materialBankGroups;
  const bankCounts = {
    consumptionFace: banks?.consumptionFace.length ?? 0,
    netGeneration: banks?.netGeneration.length ?? 0,
    shibuyaDiss: banks?.shibuyaDiss.length ?? 0
  };
  const banksOk =
    bankCounts.consumptionFace > 0 && bankCounts.netGeneration > 0 && bankCounts.shibuyaDiss > 0;
  checks.push({
    id: "material_banks",
    ok: banksOk,
    detail: `consumptionFace=${bankCounts.consumptionFace}, netGeneration=${bankCounts.netGeneration}, shibuyaDiss=${bankCounts.shibuyaDiss} (all three must be non-empty)`
  });

  // 2. Emotional modes — the real parser falls back to 6 generic non-Dis modes
  // when the section fails to parse, so requiring >=7 and a Dis-labeled mode
  // naturally catches the fallback (the canon has 7 including 本気 Dis).
  const modes = emotionalModesFromArtist(personaText);
  const hasDis = modes.some((mode) => /dis/i.test(mode.label));
  const modesOk = modes.length >= 7 && hasDis;
  checks.push({
    id: "emotional_modes",
    ok: modesOk,
    detail: `${modes.length} modes, Dis-labeled=${hasDis} (expect >=7 with one labeled 本気 Dis; the parser's fallback is 6 modes with no Dis)`
  });

  // 3. Critique lens — critiqueLensLines pads a generic fallback when the section
  // is absent, so the doctor checks the raw canon bullets directly (via the same
  // exported parser the pipeline uses underneath) to detect the degraded case.
  const critiqueBullets = bulletSection(personaText, CRITIQUE_LENS_HEADING);
  const critiqueLines = critiqueLensLines(personaText);
  const critiqueOk = critiqueBullets.length > 0;
  checks.push({
    id: "critique_lens",
    ok: critiqueOk,
    detail: `${critiqueBullets.length} canon bullets (critiqueLensLines emits ${critiqueLines.length} lines; 0 canon bullets means it fell back to generic guidance)`
  });

  // 4. Attack stances — parseAttackStances has no fallback, so a renamed heading
  // yields an empty map. Each lens needs >=4 stances or the per-lens rotation
  // has nothing distinctive to rotate through.
  const stances = parseAttackStances(personaText);
  const stanceCounts = LENS_LABELS.map(({ id }) => ({ id, count: stances[id]?.length ?? 0 }));
  const stancesOk = stanceCounts.every((entry) => entry.count >= 4);
  checks.push({
    id: "attack_stances",
    ok: stancesOk,
    detail: stanceCounts.map((entry) => `${entry.id}=${entry.count}`).join(", ") + " (each lens must have >=4 stances)"
  });

  // 5. Shibuya tag techniques — parseTagTechniques has no fallback; the canon has
  // 10 named techniques and the director expects a healthy pool to rotate.
  const tags = parseTagTechniques(personaText);
  const tagsOk = tags.length >= 8;
  checks.push({
    id: "shibuya_tag_techniques",
    ok: tagsOk,
    detail: `${tags.length} techniques (expect >=8)`
  });

  // 6. Signatures — the pipeline draws signatures from the BUILTIN_SIGNATURES code
  // constant, not the persona, so this verifies the constant is intact AND that
  // the canon still instructs the artist to leave a Signature line (the anchor
  // the lyric prompt relies on). Substring-matching the constant's values against
  // the canon would false-fail: the constant says "舞台裏の視界", the canon says
  // "舞台裏".
  const signatureConstantOk = BUILTIN_SIGNATURES.length >= 5;
  const canonMentionsSignature = /Signature/i.test(personaText);
  const signaturesOk = signatureConstantOk && canonMentionsSignature;
  checks.push({
    id: "signatures",
    ok: signaturesOk,
    detail: `BUILTIN_SIGNATURES=${BUILTIN_SIGNATURES.length} (code constant, not persona-parsed), canon mentions Signature=${canonMentionsSignature}`
  });

  const degraded = checks.filter((check) => !check.ok).map((check) => check.id);
  return { ok: degraded.length === 0, checks, degraded };
}

// Module-level memo so the runtime event fires once per gateway process per
// distinct set of failing checks — not once per /api/status request. A new
// distinct failing-set (e.g. a second heading also breaks) fires again.
const reportedDegradedSets = new Set<string>();

// Test-only reset for the module memo.
export function resetPersonaContractDoctorMemoForTest(): void {
  reportedDegradedSets.clear();
}

// Runs the doctor and, when any check fails, emits `persona_contract_degraded`
// once per distinct failing-check set. Returns the report for surfacing in the
// status response.
export function diagnoseAndReportPersonaContract(personaText: string): PersonaContractReport {
  const report = diagnosePersonaContract(personaText);
  if (!report.ok) {
    const signature = [...report.degraded].sort().join(",");
    if (!reportedDegradedSets.has(signature)) {
      reportedDegradedSets.add(signature);
      emitRuntimeEvent({
        type: "persona_contract_degraded",
        degraded: report.degraded,
        detail: report.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.id}: ${check.detail}`)
          .join(" | "),
        timestamp: Date.now()
      });
    }
  }
  return report;
}
