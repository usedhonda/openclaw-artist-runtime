<!-- Author: artist-runtime contributors. Sources: Suno official docs (suno.com/blog), V5.5 release notes. License: MIT. -->

# Suno V5.5 Knowledge Pack

This directory contains artist-runtime's clean-room Suno V5.5 production notes.
The files are original MIT-licensed guidance for the plugin's prompt builders,
validators, and future repair flows.

## Source Basis

Primary source families:

- Suno blog: V5.5 announcement and product release notes.
- Suno Help Center: Custom mode, own lyrics, Exclude, song length, Voices, Custom Models, My Taste, Reuse Prompt, and style-instruction articles.
- Suno Community Guidelines: privacy, impersonation, intellectual-property, and public-link risk boundaries.

This knowledge pack intentionally avoids copying third-party prompt manuals or
community prompt packs. Treat all prose here as artist-runtime-owned guidance,
not as an imported manual.

## Files

- `lyric_craft.md` - rules for writing singable lyrics with concrete imagery,
  controlled repetition, hooks, rhyme, and safe revision boundaries.
- `song_structures.md` - section roles, energy curves, and metatag placement
  for common song forms.
- `suno_v55_reference.md` - V5.5 feature notes, style prompt limits, slider
  defaults, ending control, duration risks, and rights boundaries.
- `yaml_template.md` - a compact metadata + lyrics container for prompt pack
  persistence.
- `style_catalog.md` - short tag templates by genre family.

## Builder Contract

Future builders should keep these invariants:

- Style core: concise tags first, usually under 120 characters.
- Style total: keep performance directions compact, target under 400 characters.
- Exclude: short, specific, and separate from Style.
- Lyrics field: only lyrics and bracketed section instructions; never prose
  instructions outside tags.
- YAML metadata: machine-readable context and production hints; not a substitute
  for lyrics.
- Copyright safety: describe sound, role, texture, and energy without naming
  living artists, existing songs, albums, or protected voices as targets.
- Duration guard: avoid underspecified or tiny lyric bodies for full songs; very
  short inputs can lead to short generations.

## Primary Sources Checked

- https://suno.com/blog/v5-5
- https://help.suno.com/en/articles/11362305
- https://help.suno.com/en/articles/11362369
- https://help.suno.com/en/articles/11362497
- https://help.suno.com/en/articles/2415873
- https://help.suno.com/en/articles/3161921
- https://help.suno.com/en/articles/2409473
- https://help.suno.com/en/articles/2417409
- https://help.suno.com/en/articles/5782849
- https://suno.com/community-guidelines
