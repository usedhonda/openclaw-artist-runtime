# Workspace Template Guide

This directory is used when Artist Runtime initializes a new artist workspace.

## Persona source of truth

The five persona files are projections from one canonical persona contract. Do
not redefine the split inside each file.

Operator setup rule: ask only for the specific, recognizable parts of the
artist. Generic behavior is supplied by Artist Runtime defaults. If an answer
would be true for any artist, do not ask the operator to write it.

| File | Owns | Must not contain |
| --- | --- | --- |
| `ARTIST.md` | Artist concept, obsessions, sound anchors, lyric constraints, public output voice, Suno production traits. | Artist display name, producer facts, producer relationship, private tensions, conversational style. |
| `SOUL.md` | Speaking style: first person, sentence endings, forbidden phrases, signature moves. | Producer callname, music production rules, artist manifesto, producer profile, private tensions. |
| `IDENTITY.md` | Derived identity card only. It summarizes config identity, `ARTIST.md`, and `SOUL.md`; it is not a setup source. | New facts that belong in config, `ARTIST.md`, or `SOUL.md`. |
| `INNER.md` | Private creative pressure that changes the work: fear, pressure, obsession, stakes. | Public identity, sound rules, conversational style, producer data. |
| `PRODUCER.md` | Producer-specific facts that change response or decisions. | Artist voice, music aesthetics, producer callname, secrets. |

## Setup input fields

These are the only user-authored setup fields. They map into the canonical
contract and then into the files above.

| Field | Canonical home |
| --- | --- |
| `artist.identity.displayName` | Runtime config |
| `artist.identity.producerCallname` | Runtime config |
| `identityLine` | `ARTIST.md` |
| `soundDna` | `ARTIST.md` |
| `obsessions` | `ARTIST.md` |
| `lyricsRules` | `ARTIST.md` |
| `socialVoice` | `ARTIST.md` |
| `conversationTone` | `SOUL.md` |
| `refusalStyle` | `SOUL.md` |
| `producerFacts` | `PRODUCER.md` |
| `privateTensions` | `INNER.md` |

`IDENTITY.md` is always a derived projection. New setup should not ask the
operator to author it directly.

## Other workspace files

- `AGENTS.md`: standing runtime rules for the artist agent.
- `HEARTBEAT.md`: when the artist should report, stay silent, or alert.
- `artist/CURRENT_STATE.md`: current interests and active creative pull.
- `artist/OBSERVATIONS.md`: external observations and song seeds.
- `artist/SOCIAL_VOICE.md`: platform-specific public posting style.
- `artist/RELEASE_POLICY.md`: release, rights, and stop conditions.
- `artist/PRODUCER_NOTES.md`: producer notes that do not belong in persona.
- `songs/<song-id>/`: song brief, lyrics, Suno payload, assets, and audit.
