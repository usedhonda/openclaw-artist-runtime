# Loop state: Persona Setup と Suno 生成品質

Created: 2026-06-28
Kind: closed

## Budget

- iteration cap 6
- no-progress streak 2
- one failure class max 3 focused attempts

## Current baseline

- Latest pushed implementation baseline before this loop: `24e24ae fix: repair setup ai drafts and dopagaki variation`.
- Last known full gates from the preceding implementation work:
  - `npm run typecheck` passed
  - `npm test` passed
  - `npm run build` passed
  - `npm run pack:verify` passed
- Latest local prompt-pack smoke from the preceding work:
  - `.local/openclaw/workspace/songs/spawn_f3820d/prompts/prompt-pack-v005/`
  - validation valid `true`
  - validation errors `[]`
  - YAML language `Japanese 60% / English 40%`
  - Style included overt dopamine-pop pressure and glitch-vocal sparks

## Done

- Loop contract created to cover Persona Setup canonical ownership, AI draft buttons, generated/internal warning handling, and Suno style/language propagation.

## Failed / blocked

- None recorded yet.

## Next step

Run `.loop/persona-suno-regression.md` once. Start with the focused persona tests, then prompt-pack tests, then full gates if any code changed.
