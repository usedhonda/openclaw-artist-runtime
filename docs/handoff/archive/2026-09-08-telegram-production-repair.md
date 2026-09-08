# Handoff: Telegram production conversation repair

Task ID: telegram-production-repair
Last updated: 2026-09-08 by implementer
Status: done

## Objective

Restore song-bound conversational revision, partial restoration, adoption, and
approved-version Suno preparation without changing the manual Create boundary.

## Scope and completed work

- Isolated candidate revisions preserve adopted lyric history and unedited
  sections. Explicit source/restoration provenance prevents ambiguous restores.
- Idempotent adoption preserves old lyrics and the original song lifecycle,
  including validation failures; per-song serialization prevents adoption races.
- Five scoped conversational tools remain behind the restricted coding profile.
  Background notices identify their song without replacing the conversation target.
- Generation checks the approved payload hash and pack version. Prepare-only
  returns confirmed readiness while the connector and pending marker remain active.
- Manual acceptance requires fresh feed evidence; old cards or unavailable feed
  keep waiting until the existing deadline rather than closing the prepared form.
- Nonaccepted prepare-only attempts leave archived status and selected audio intact.

## Reflection and evidence

- Linux runtime rebuilt and reflected through an idle, preflight-checked gateway
  child replacement under the existing supervisor. No force restart was used.
- Real Telegram: verse expansion with other sections unchanged, Hook revision,
  partial restoration, adoption, and approved lyrics/style form preparation passed.
- Both old lyric hashes remained unchanged; the adopted candidate matched the
  persisted lyrics, payload hash, and single adoption receipt.
- Telegram returned the input-complete/manual-Create response without timing out.
- Read-only browser verification at 155 seconds found all 2,314 lyric characters
  and Style identical to the approved payload, the pending run still active, no
  false accepted run, and the original selected audio and archived state intact.
- Runtime source: `d1e60db`; additional driver regression: `11d7f85`.

## Commands and tests

- `npm run typecheck` and `npm run lint -- --no-fix`: passed.
- `npm test -- --reporter=json`: 404 files, 2,048 tests, zero failures.
- Subsequent test-only driver regression: 6 tests passed in its focused file;
  this proves unavailable reconciliation does not end the manual wait early.
- `npm run build:runtime`: passed locally and on Linux.
- Intent Drift Check: pass.

## Incident correction

A live preparation falsely accepted two pre-existing takes before the producer
clicked Create. The original archived state and selected audio were restored.
A failed correction, prompt-ledger annotation, and human-readable incident note
were appended; historical entries were not rewritten or deleted.

## Decided and boundaries

- No machine Create, public publishing, CAPTCHA automation, or replacement Cover.
- Tempo-only editing was not added: the observed Adjust Speed menu was disabled.
  The original audio was not regenerated as a substitute.
- The prepared form retains the existing 20-minute human-submit deadline. No
  indefinite wait, new daemon, ledger format, or config-schema change was added.
- Live instructions outside the production-conversation section were preserved.

## Known risks and next operation

Actual manual Create and subsequent newly generated audio were not exercised in
this verification. The form was deliberately left waiting for the operator.
The historical false accepted entry remains as incident evidence; the correction
is appended rather than removing history, so historical raw acceptance counts may
still include that entry. No budget or counter was silently rewritten.
