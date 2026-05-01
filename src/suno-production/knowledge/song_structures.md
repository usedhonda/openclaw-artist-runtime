<!-- Author: artist-runtime contributors. Sources: Suno official docs (suno.com/blog), V5.5 release notes. License: MIT. -->

# Song Structures and Section Roles

Suno's Help Center describes current models as able to create longer, structured
songs, with V4.5/V5 reaching up to eight minutes before extension. Structure
still matters: if the lyric body is too small or sections are vague, generation
can end early or loop without a clear landing.

## Recommended Section Tags

Use simple bracket tags, optionally with short performance notes:

- `[Intro]`
- `[Verse 1]`
- `[Pre-Chorus]`
- `[Chorus]`
- `[Post-Chorus]`
- `[Verse 2]`
- `[Bridge]`
- `[Breakdown]`
- `[Instrumental]`
- `[Outro]`

Keep the first word of the tag recognizable. Add only the performance cues that
matter for that section.

## Nine-Section Pop/Rock Spine

Use when a full song is desired:

1. Intro - establishes tempo, texture, or motif.
2. Verse 1 - concrete scene and speaker.
3. Pre-Chorus - pressure rises.
4. Chorus - hook and central phrase.
5. Verse 2 - new detail or consequence.
6. Pre-Chorus - shorter or more urgent repeat.
7. Chorus - return with more force.
8. Bridge - contrast, confession, or turn.
9. Final Chorus / Outro - peak and landing.

This is a default spine, not a law. Short songs can omit pre-chorus or bridge.

## Energy Curve

Use section energy to avoid flat generations:

- Intro: 1-3
- Verse: 3-5
- Pre-Chorus: 5-7
- Chorus: 7-9
- Verse 2: 4-6
- Bridge: 2-5 or 8 if it is a climax
- Final Chorus: 9-10
- Outro: 1-4

Energy should change for a reason. A low bridge can make the final chorus feel
larger; a high bridge can act as a pressure break before the last hook.

## Structure Families

### Direct Pop

`Intro -> Verse 1 -> Pre-Chorus -> Chorus -> Verse 2 -> Pre-Chorus -> Chorus -> Bridge -> Final Chorus -> Outro`

Best for hook-forward songs with a clear emotional lift.

### Rap / Spoken Lead

`Intro -> Verse 1 -> Hook -> Verse 2 -> Hook -> Bridge or Break -> Verse 3 -> Final Hook`

Keep hooks short. Use verse tags to define flow changes, e.g. close mic,
double-time, call-and-response, or stripped beat.

### Dance / Electronic

`Intro -> Build -> Drop -> Breakdown -> Build -> Drop -> Outro`

Use fewer lyric lines. Put the memorable phrase in Build or Drop and keep the
Style tags precise about rhythm and low end.

### Ballad / Slow Narrative

`Intro -> Verse 1 -> Verse 2 -> Chorus -> Verse 3 -> Bridge -> Final Chorus -> Outro`

Allows more story before the first hook. Keep lines breathable.

### Experimental / Odd Form

Use explicit section tags and short cues:

- `[Verse 1 - 16 bars, sparse]`
- `[Break - silence before chorus]`
- `[Outro - short, resolved stop]`

If the form is unusual, the metadata should name the form in one compact line.

## Metatag Placement

Put arrangement information where it has the least risk of being sung:

- Style: global genre, tempo, key, mood, voice, instruments, mix.
- YAML metadata: global production notes and constraints.
- Section tag annotation: section-specific changes.
- Lyric lines: only words meant to be performed.

## Duration Guard

For a complete song, avoid tiny lyric bodies. A handful of lines can be treated
as a short clip. Give the model enough section material:

- at least two verses or verse-like blocks
- a repeated hook
- an ending tag or final section
- enough section tags to imply a full path

If the song is intentionally short, mark it as a short cue or interlude.

## Primary Sources Checked

- https://help.suno.com/en/articles/2409473
- https://help.suno.com/en/articles/2417409
- https://help.suno.com/en/articles/5782849
