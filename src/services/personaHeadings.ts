// Canonical persona/state section headings and one heading normalizer, shared by
// every parser that slices the live ARTIST.md / CURRENT_STATE.md and by the
// persona contract doctor that validates them. Before this module each parser
// carried its own string literal and matched it exact-line, so a heading that
// gained a trailing space, changed case, or picked up a full-width space silently
// returned [] and the pipeline fell back to generic material with no error.
//
// Leaf module: zero imports, so it can be imported from anywhere (parsers,
// director, doctor) without an import cycle. The constants defined here are THE
// contract — the doctor and the parsers read the same strings, so they cannot
// drift apart.

// Canonical headings, written exactly as they appear in the canon (with their
// markdown level prefix). normalizeHeading strips the prefix during comparison,
// so callers may pass either the full `### X` form or the bare `X` text.
export const EMOTIONAL_MODES_HEADING = "### Emotional Modes";
export const CRITIQUE_LENS_HEADING = "### Critique Lens";
export const TAG_TECHNIQUES_HEADING = "### Tag Techniques";
export const ATTACK_STANCES_HEADING = "### Attack Stances";
export const CATCHPHRASES_HEADING = "### Catchphrases";
export const CURRENT_OBSESSIONS_HEADING = "## Current Obsessions";
export const CURRENT_ARTIST_CORE_HEADING = "## Current Artist Core";

// Per-lens material bank headings are not one fixed constant: the persona
// declares one `### Material Bank: <lens_id>` section per lens it names under
// `### Critique Lens`. This prefix is what a heading line is tested against, and
// `materialBankHeading` builds the canonical heading for a given lens id (used by
// the doctor's detail text and by any writer that needs to emit one).
const MATERIAL_BANK_HEADING_PREFIX = "Material Bank:";

export function materialBankHeading(lensId: string): string {
  return `### Material Bank: ${lensId}`;
}

// True when `headingText` (with or without its markdown `#` prefix) is a
// `### Material Bank: <lensId>` heading, tolerant of the same case/whitespace
// differences normalizeHeading folds away. Returns the lens id (normalized, so
// always lowercase — lens ids are constrained to `[a-z0-9_]+` already), or
// undefined when the line is not a material-bank heading at all.
export function materialBankLensId(headingText: string): string | undefined {
  const normalized = normalizeHeading(headingText);
  const prefix = normalizeHeading(MATERIAL_BANK_HEADING_PREFIX);
  if (!normalized.startsWith(prefix)) return undefined;
  const id = normalized.slice(prefix.length).trim();
  return id.length > 0 ? id : undefined;
}

// Normalize a heading (or a whole heading line) for tolerant comparison:
// full-width spaces become ASCII spaces, leading markdown `#` markers are
// dropped, runs of whitespace collapse to one space, and case is folded. This is
// what turns the old exact-line match ("one stray space => []") into a match that
// survives ordinary hand edits to the canon.
export function normalizeHeading(value: string): string {
  return value
    .replace(/\u3000/g, " ")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// True when `line` names the same heading as `canonical`, tolerant of the
// differences normalizeHeading folds away. Either argument may carry or omit the
// markdown `#` prefix.
export function headingMatches(line: string, canonical: string): boolean {
  return normalizeHeading(line) === normalizeHeading(canonical);
}
