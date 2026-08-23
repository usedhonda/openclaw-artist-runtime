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
export const SHIBUYA_TAG_TECHNIQUES_HEADING = "### Shibuya Tag Techniques";
export const ATTACK_STANCES_HEADING = "### Attack Stances";
export const CONSUMPTION_FACE_MATERIAL_BANK_HEADING = "### Consumption & Face Material Bank";
export const NET_GENERATION_MATERIAL_BANK_HEADING = "### Net & Generation Material Bank";
export const SHIBUYA_DISS_MATERIAL_BANK_HEADING = "### Shibuya Diss Material Bank";
export const CURRENT_OBSESSIONS_HEADING = "## Current Obsessions";
export const CURRENT_ARTIST_CORE_HEADING = "## Current Artist Core";

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
