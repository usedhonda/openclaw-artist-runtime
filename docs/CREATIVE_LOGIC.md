# Creative Logic

This file records runtime-facing creative policy that affects autonomous song generation.

## Shibuya Anger Lens

New songs should not drift into neutral observation when the artist persona is angry. The base mood for ideation and spawn briefs is:

`aggressive urban critique, biting sarcasm, late-night pressure, anti-gloss civic anger`

The lyric prompt applies a Shibuya anger lens after reading news/X material:

- Start from the actual news or X reaction source.
- Fold it back into present-day Shibuya as a critique lens, not as the search origin.
- Target urban systems, incentives, signage, brands, safety theater, and redevelopment logic.
- Do not attack private individuals or protected traits.
- Use concrete images, internal rhyme, and a punchline turn instead of neutral summary.

## Dopagaki Variation

Dopagaki is an autonomous anti-template variation, not a separate genre. The current target rate is about 40%.

- Source of truth: `src/services/creativeVariationPolicy.ts`.
- Selection is deterministic from song id, date, observation text, and brief text.
- The selector can bias upward after long non-dopagaki runs and downward after repeated dopagaki runs.
- Active mode is overt: clipped fragments, instant hook pressure, bilingual chant accents, and fast-development contrast.
- High-speed or double-density delivery is limited to 2-4 bar bursts. The full song must not become double-time.
- The nu-jazz low-bass core and dry intelligible lead remain intact.

The same decision feeds both lyric prompting and Suno style variation:

- Lyrics: `buildLyricsDraftingPrompt()` receives the variation decision and adds bounded overt instructions.
- Style: prompt-pack creation passes `styleVariationSeed` into the Suno style builder, which selects the dopagaki overt profile.

## Rap Lyrics Density

The default 80-bar nu-jazz rap DurationPlan is dense by default. Verse 1 and Verse 2 should carry 14-16 lines each, roughly one lyric line per bar, with internal rhymes and controlled syllable density instead of spacious sketch writing.

- Source of truth: `src/suno-production/durationPlan.ts`.
- Bare lyrics must clear a dual floor before a draft is accepted: at least 1200 bare-lyric characters (80 bars x 15) AND at least 52 non-marker lyric lines. Either shortfall rejects the draft.
- Short drafts trigger the existing lyrics repair/retry path and then `lyrics_generation_degraded` if all attempts stay thin.
- Section marker annotations in Suno YAML stay compact, usually 2-5 words, so metadata does not consume the lyrics box.
- `lyricsZone` reports overflow from the submitted Suno payload, but underused/near-max status is based on bare lyrics against the box remaining after markers.
- Dense does not mean full-song double-time. `noDoubleTimeVocal` remains true; dopagaki can still add bounded 2-4 bar bursts.

## Untouched Contracts

These policies must not change the Suno registration contract:

- Original lyrics remain in `songs/<id>/lyrics/lyrics.vN.md`.
- Suno registration lyrics remain in `songs/<id>/suno/lyrics-suno.md`.
- `normalizeSunoRegistrationJapanese()` is still the only registration-language repair path.
- Artist language ratio policy remains authoritative.
