// Persona contract doctor. A safety net for the class of failure where the live
// ARTIST.md silently stops parsing into what the creative pipeline needs — a
// renamed heading, a gutted section, a fallback that quietly takes over. The
// doctor runs the REAL parsers the pipeline uses (never a reimplementation) and
// loudly reports every check that no longer holds, so "the persona degraded and
// nobody noticed" cannot happen again.

import { extractPersonaMotifs } from "./personaMotifExtractor.js";
import { bulletSection, emotionalModesFromArtist, parseCritiqueLenses, parseSignatures } from "./creativeVariationPolicy.js";
import { critiqueLensLines } from "./creativeVariationPolicy.js";
import { parseAttackStances, parseTagTechniques } from "./creativeDirector.js";
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

// Pure: no I/O, no memo, no emit. Given the persona text, run the real parsers
// and return which contracts hold. Callers that want the "notify once" behavior
// use diagnoseAndReportPersonaContract below.
export function diagnosePersonaContract(personaText: string): PersonaContractReport {
  const checks: PersonaContractCheck[] = [];

  // The persona's own lens roster. Every lens-scoped check below (material
  // banks, attack stances) is evaluated against whatever the persona declares —
  // there is no fixed lens set any more.
  const lenses = parseCritiqueLenses(personaText);

  // 1. Material banks — extractPersonaMotifs is what the director reads to pick a
  // lens and its material. At least one lens must be declared, and every
  // declared lens needs a non-empty `### Material Bank: <id>` or the lens
  // rotation collapses onto whichever bank survived (or has nothing to rotate
  // through at all).
  const banks = extractPersonaMotifs(personaText).materialBankGroups ?? {};
  const lensBankCounts = lenses.map((lens) => ({ id: lens.id, count: banks[lens.id]?.length ?? 0 }));
  const banksOk = lenses.length > 0 && lensBankCounts.every((entry) => entry.count > 0);
  checks.push({
    id: "material_banks",
    ok: banksOk,
    detail:
      lenses.length === 0
        ? "0 lenses declared under ### Critique Lens (expect >=1, each with a non-empty ### Material Bank: <id>)"
        : lensBankCounts.map((entry) => `${entry.id}=${entry.count}`).join(", ") +
          " (every declared lens must have a non-empty material bank)"
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
  // or a lens missing its `[lens_id]:` stance line yields an empty pool for it.
  // >=2 stances per declared lens is the floor that still lets the per-song
  // rotation exclude the previous pick and have something left to choose.
  const stances = parseAttackStances(personaText);
  const stanceCounts = lenses.map((lens) => ({ id: lens.id, count: stances[lens.id]?.length ?? 0 }));
  const stancesOk = lenses.length > 0 && stanceCounts.every((entry) => entry.count >= 2);
  checks.push({
    id: "attack_stances",
    ok: stancesOk,
    detail:
      stanceCounts.map((entry) => `${entry.id}=${entry.count}`).join(", ") +
      " (each declared lens must have >=2 stances)"
  });

  // 5. Tag techniques — parseTagTechniques has no fallback; >=2 is the floor that
  // still lets the per-song rotation exclude the previous pick and have
  // something left to choose.
  const tags = parseTagTechniques(personaText);
  const tagsOk = tags.length >= 2;
  checks.push({
    id: "tag_techniques",
    ok: tagsOk,
    detail: `${tags.length} techniques (expect >=2)`
  });

  // 6. Signatures — parseSignatures reads the persona's own `- Signature: ...`
  // bullet; the director no longer has a code-level fallback list, so an absent
  // or empty bullet is a real degradation, not just a missing mention.
  const signatures = parseSignatures(personaText);
  const signaturesOk = signatures.length > 0;
  checks.push({
    id: "signatures",
    ok: signaturesOk,
    detail: `${signatures.length} declared via a "- Signature: ..." bullet (expect >=1)`
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
