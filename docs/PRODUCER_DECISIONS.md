# Producer decisions

Standing values the producer set by explicit instruction. They are the source of
truth for the matching code constants, and `tests/producer-decisions.test.ts`
fails when code and this file disagree.

Rules:

- Change a value here only on an explicit producer instruction. Update this file,
  the code, and the dependent docs in the same commit, and say in the commit
  message that the producer asked for it.
- Never change a value here as part of an unrelated fix. If a change seems needed,
  ask the producer first.
- Keep the history table append-only, so the order of rulings stays visible.

## Suno normal generation controls

Code: `NORMAL_SUNO_CONTROLS` in `src/suno-production/generatePromptPack.ts`.

| Control | Value |
|---|---|
| maxMode | On |
| personalize | Off |
| duration | 3:30 |
| variety | 2 |
| styleInfluence | 100 |

### History

| Date (JST) | Ruling | Commit |
|---|---|---|
| 2026-09-16 | Max Mode Off, Personalize On, Duration 3:30, Variety 2, Style Influence 100 | `5bfaeb6` |
| 2026-09-17 | Max Mode On, Personalize Off (others unchanged) | `ce23c62` |
| 2026-09-18 | Unauthorized revert to Max Mode Off / Personalize On inside an unrelated fix | `6b89bbe` |
| 2026-09-19 | Producer reconfirmed Max Mode On, Personalize Off; revert undone | this file's commit |
