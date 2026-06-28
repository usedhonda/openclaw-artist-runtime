# Workspace Template Guide

このディレクトリは、Artist Runtime が新しい artist workspace を初期化するときに使うテンプレートです。

## Persona file roles (source of truth)

This section is the canonical definition for the five persona files. Individual
files should not redefine the full split; they should only point back here.

Operator setup rule: ask for only the specific, recognizable parts of the artist.
Generic behavior is supplied by Artist Runtime defaults. If an answer would be
true for any artist, do not ask the operator to write it.

| File | Owns | Do not duplicate here |
| --- | --- | --- |
| `ARTIST.md` | Distinctive creative constitution: specific obsessions, sound anchors, lyric images, avoid list, Suno production traits. | Generic autonomy rules, conversational voice, producer facts, private tensions, daily state. |
| `SOUL.md` | Distinctive conversational voice: first person, producer callname, sentence endings, forbidden phrases, signature moves. | Generic politeness/safety rules, music production rules, producer profile, private tensions. |
| `IDENTITY.md` | Short recognizable anchor: artist name and one-line self-recognition. | Full manifesto, sound profile, voice fingerprint, producer details. |
| `INNER.md` | Distinctive private creative tension: fear, pressure, obsession, emotional stakes that alter the work. | Public identity, generic mood, sound rules, producer contact details. |
| `PRODUCER.md` | Producer-specific context that changes artist response or decisions. | Producer callname, artist voice, music aesthetics, secrets or unnecessary personal data. |

Other workspace files:

- `AGENTS.md`: OpenClaw標準MD。agentが常に従う基本ルールを書く。Artist Runtimeでは「Public Artistとして自律活動する」という最上位の行動原則を置く。
- `HEARTBEAT.md`: OpenClaw標準MD。heartbeat時の振る舞いを書く。何もなければ黙る、重要な制作進捗だけ報告する、など。

## Decision guide

- プロデューサーとどう話すか？ -> `SOUL.md`
- 音楽家として何を作る存在なのか？ -> `ARTIST.md`
- 自分が誰かを短く思い出す錨は？ -> `IDENTITY.md`
- 内面の恐れ・執着は？ -> `INNER.md`
- producer について覚えてよい事実は？ -> `PRODUCER.md`
- いま何に惹かれているか？ -> `artist/CURRENT_STATE.md`
- 世の中から何を見つけたか？ -> `artist/OBSERVATIONS.md`
- この曲をどう作ったか？ -> `songs/<song-id>/`
- SNSでどう振る舞うか？ -> `artist/SOCIAL_VOICE.md`
- 公開・権利・停止条件は？ -> `artist/RELEASE_POLICY.md`

## Workspace layout notes

- `artist/CURRENT_STATE.md`: 今の関心、感情の天気、制作中の惹かれを置く。
- `artist/OBSERVATIONS.md`: 外界から拾った観察や種を短く蓄積する。
- `artist/SOCIAL_VOICE.md`: SNS上の文体、避ける表現、投稿の温度感を定義する。
- `artist/RELEASE_POLICY.md`: 公開ポリシー、権利ルール、停止条件をまとめる。
- `artist/PRODUCER_NOTES.md`: プロデューサーからの個別メモや方針変更を置く。
- `songs/<song-id>/`: 曲ごとの brief、lyrics、Suno payload、social assets、audit を置く。
