<!-- Author: artist-runtime contributors. Sources: Suno official docs (suno.com/blog), V5.5 release notes. License: MIT. -->

# Lyric Craft Rules

These rules are written for generated songs that will be sent through Suno
Custom mode with original lyrics. Suno's own Help Center states that Custom mode
accepts user lyrics and additional context, and that original lyrics remain the
writer's rights. This file focuses on making those lyrics singable before they
reach the create form.

## Core Principle

Write lyrics as a performance script, not as a prose essay. Every non-tag line
in the lyric body may be sung, so the text must already sound like something a
vocalist can phrase.

## Drafting Sequence

1. Define the speaker and emotional pressure.
2. Pick one concrete image that can return later.
3. Decide the chorus hook before filling verses.
4. Sketch the section map.
5. Write short, singable lines.
6. Check repetition, vowel endings, and breath points.
7. Convert production notes into bracketed section tags or YAML metadata, not
   into lyric lines.

## Concrete Writing

Prefer sensory and visible details:

- good: a train gate, a cracked phone screen, a cold cup, a blinking sign
- weak: sadness, society, anxiety, future, love as abstract nouns

Emotion can appear, but it should not carry the whole line. If a line explains
what the listener should feel, replace part of it with an object or action.

## Foreshadowing

Use one recurring image per song. Place it quietly in the first verse, alter it
in the bridge or final chorus, and let the listener notice the shift.

Examples of safe transformation patterns:

- object changes owner
- place changes weather or time of day
- casual phrase returns with a darker meaning
- missing detail becomes visible near the end

Do not stack multiple symbolic systems. One image that changes is stronger than
five images that only decorate.

## Hook Rules

A chorus hook should be short enough to remember after one listen. Aim for:

- three to eight words
- a strong first phrase
- repeatable wording with one small variation
- open vowel endings when possible
- a line that names the song's emotional argument

The hook is not required to explain the whole story. It should be the phrase the
song keeps returning to because the speaker cannot escape it.

## Rhyme and Flow

Use rhyme as stability, not decoration.

- Verses can use loose vowel echoes.
- Choruses should rhyme or rhythmically repeat more clearly.
- Bridges can break rhyme to signal a perspective change.
- Rap sections should group internal rhymes by bar, not only by line ending.

For Japanese lyrics, watch vowel movement and line length. Adjacent lines in the
same section should feel close enough to sing in the same melodic pocket.

## Singability Checklist

- Verse lines: usually medium length, enough room for detail.
- Chorus lines: shorter, cleaner, and easier to repeat.
- Avoid repeated tongue-twisters unless the style is explicitly percussive.
- Avoid stuffing proper nouns into every line; save them for impact points.
- Use punctuation for breath, not for prose grammar.
- Keep English phrases intentional and pronounceable.

## Bracket Safety

Suno lyric fields may interpret plain text as singable. Keep instructions inside
brackets:

- `[Verse 1 - close vocal, sparse drums]`
- `[Chorus - full band, wide harmony]`
- `[Bridge - stripped, half-time feel]`

Never write a sentence like "make this chorus louder" outside a bracket.

## Rights and Identity Safety

- Do not ask for a living artist's voice.
- Do not title a style after an existing song, album, or performer.
- Do not paste lyrics from another writer unless the operator confirms rights.
- Do not imitate a private person's voice or identity.

## Repair Targets

When repairing AI lyrics, prefer these fixes:

1. Remove prose instructions from the lyric body.
2. Shorten lines that cannot be sung.
3. Add a stronger chorus hook.
4. Replace abstract explanation with a visible image.
5. Reduce repeated ideas.
6. Add a final landing line so the song does not feel endless.

## Primary Sources Checked

- https://help.suno.com/en/articles/2415873
- https://help.suno.com/en/articles/2417409
- https://help.suno.com/en/articles/3599681
- https://suno.com/community-guidelines
