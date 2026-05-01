<!-- Author: artist-runtime contributors. Sources: Suno official docs (suno.com/blog), V5.5 release notes. License: MIT. -->

# Suno V5.5 Reference

This file summarizes clean-room operational guidance for artist-runtime. It is
based on public Suno V5.5 announcement material and Help Center articles.

## V5.5 Feature Context

Suno announced V5.5 on March 26, 2026 with three major personalization features:

- Voices: create and use a private voice profile after verification.
- Custom Models: Pro/Premier users can tune a private model from owned songs.
- My Taste: preference learning based on a user's recurring styles and moods.

For artist-runtime, this means prompt packs should be specific enough to guide
the song but not so overloaded that they fight personalization features.

## Custom Mode Fields

Custom mode can receive:

- lyrics
- style descriptors
- advanced options such as Exclude
- title
- optional voice/model choices depending on account access

The plugin must save payloads before create actions so the prompt ledger can
reconstruct what was sent.

## Style Prompt Canon

Use compact tags first.

Target order:

1. genre or fusion
2. BPM
3. key
4. mood
5. vocal role
6. instruments
7. mix or room quality

Recommended limits:

- core style: target 120 characters or less
- total style: keep under 400 characters when adding performance directions
- genre count: keep to one primary style or one fusion pair
- avoid long paragraphs unless testing a deliberate detailed-style workflow

Example shape:

`nu-jazz rap, 145 BPM, D minor, tense satire, dry male vocal, Rhodes, electric bass, horn stabs, basement mix`

## Exclude Field

Use Exclude for unwanted elements rather than putting negations in Style.

Keep it:

- short
- specific
- comma-separated
- usually two to five items

Avoid excluding the entire identity of the track. Remove likely failure modes,
not the instruments that define the genre.

## Slider Guidance

artist-runtime uses a conservative safety band unless a later phase defines a
tested exception:

- safe range: 15-85
- baseline exploration: Weirdness 35-55, Style Influence 45-70
- stricter structure: lower Weirdness, higher Style Influence
- voice or audio-reference workflows: start Audio Influence low or moderate and
  increase gradually only when the operator has opted in

Avoid 0 or 100 in unattended operation. Extremes are for deliberate experiments,
not autonomous runs.

## Voices and Rights

Voices require verification and rights confirmation. artist-runtime must not:

- request another person's voice without authorization
- impersonate a public figure
- ship prompts that name a living singer as the target voice
- upload reference material unless the operator has rights

Voice descriptions should use physical traits instead: register, breath, attack,
distance, grit, warmth, dryness.

## Ending Control

Endings should be designed before generation:

- name the final section
- give the final line a landing
- use short outro tags such as resolved, full stop, or fade
- avoid lyrics that sound like a setup for another verse unless continuation is
  intended

If a song loops or cuts awkwardly, repair the structure and final section first.

## Duration Cliff

Suno can generate long songs, but a very small lyric body can still produce a
short result. In artist-runtime this is a hard quality risk: a full-song request
must not be sent with only a fragment unless the operator asked for a cue.

Validator expectations for a normal full song:

- title present
- style present
- lyrics include multiple sections
- at least one repeated hook or chorus-like block
- ending section present
- payload has enough text to imply a complete arrangement

## Copyright and Source-Name Safety

Do not place these in Style, Exclude, or prompt metadata as targets:

- existing artist names
- existing song titles
- album names
- labels or protected brands as sound targets
- "in the voice of" phrasing

Describe the musical result using genre, era, instrumentation, mix, energy, and
vocal qualities instead.

## Primary Sources Checked

- https://suno.com/blog/v5-5
- https://help.suno.com/en/articles/11362305
- https://help.suno.com/en/articles/11362369
- https://help.suno.com/en/articles/11362497
- https://help.suno.com/en/articles/2409473
- https://help.suno.com/en/articles/3161921
- https://suno.com/community-guidelines
