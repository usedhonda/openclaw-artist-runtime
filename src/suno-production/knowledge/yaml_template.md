<!-- Author: artist-runtime contributors. Sources: Suno official docs (suno.com/blog), V5.5 release notes. License: MIT. -->

# YAML Prompt Container

artist-runtime stores a compact YAML-style prompt container so every Suno run has
human-readable metadata plus the exact lyric body. The container is a plugin
artifact; Suno receives the lyrics text field and style fields through the driver
contract defined by later phases.

## Goals

- preserve tempo, key, form, and production intent
- keep production notes separate from sung text
- make validator checks deterministic
- keep the lyric body easy to inspect
- avoid stuffing Style with long prose

## Template

```yaml
# META (production hints; not lyric text)
version: v5.5
meta:
  title: "<song title>"
  tempo: 128
  key: "A minor"
  signature: "4/4"
  form: "intro-v1-pre-chorus-v2-pre-chorus-chorus-bridge-final-chorus-outro"
  duration_target: "full song"
  vibe: "short mood phrase"
language: "Japanese"
vocals:
  lead: "low-mid dry vocal, close mic"
  backing: "minimal harmony in final chorus"
production_notes:
  - "Keep vocal intelligible and centered."
  - "Let the rhythm section carry the groove; avoid glossy pop polish."
notes:
  - "Use bracketed section tags as arrangement hints."
  - "Clear ending; no unresolved loop."
rights:
  source_material: "original"
  style_reference_policy: "descriptive only; no artist or song names"
=== LYRICS START ===
[Verse 1 - close vocal, sparse drums]
<lyric line>
<lyric line>

[Chorus - wider, stronger hook]
<hook line>
<hook line>

[Outro - resolved, short]
<landing line>
=== LYRICS END ===
```

## Metadata Rules

- Keep metadata concise.
- Use English for machine-oriented fields.
- Put Japanese only in lyrics unless the title requires it.
- Do not add long per-section arrays when bracket tags already carry the cue.
- Do not include secrets, account identifiers, cookies, or private URLs.

## Lyrics Rules

- Lyrics between the start/end markers should contain only section tags and
  singable lines.
- Bracket tags may include short production hints.
- Any free text outside brackets can be sung; validators should reject obvious
  instructions in the lyric body.
- Preserve line breaks because they affect phrasing.

## Repair Order

If the YAML container is too large or messy:

1. shorten `production_notes`
2. shorten `notes`
3. shorten bracket annotations
4. simplify `vocals`
5. never delete required lyric sections unless the operator asked for a shorter
   song

## Validator Fields

Minimum fields for a full song:

- `version`
- `meta.title`
- `meta.tempo`
- `meta.key`
- `meta.form`
- `language`
- `vocals.lead`
- `production_notes`
- `=== LYRICS START ===`
- `=== LYRICS END ===`

## Primary Sources Checked

- https://help.suno.com/en/articles/2415873
- https://help.suno.com/en/articles/2417409
- https://help.suno.com/en/articles/3161921
