# Handoff archive: Suno root recovery

Task ID: suno-root-fix-2026-08
Archived: 2026-08-09
Status: complete

## Outcome

Autonomous Suno generation was recovered and independently verified against the
append-only runtime and song ledgers. The live run reached `accepted` and then
`imported` with `dryRun:false`, two real Suno result URLs, and zero `mock://`
URLs. No CAPTCHA automation or bypass was used, and no push was performed.

## Independent gate evidence

- Run `suno_msld8hhh` for `spawn_3e607c` has exactly two ledger records:
  `accepted` then `imported`; both are `dryRun:false`, each has two URLs, and
  the combined mock URL count is zero.
- The transient clip import remains append-only history. The post-live-run
  relink correction is exactly one `runtime_state_correction` audit entry; the
  earlier mock-state recovery correction remains preserved.
- The selected take is verified and completed. The two distinct nonzero MP3
  artifact inodes associated with the selected take remain present; duplicate
  path references resolve to those same two artifacts.
- `telegram-deliveries.jsonl` contains exactly one
  `song_take_completed` receipt for this song, with message id `1409`; no
  duplicate receipt was added by the correction.
- The CLI login/profile/CDP recovery is complete: the authoritative CLI
  session file is present, the profile split was fixed, and the final session
  was recovered without another operator login request.
- The import run identity bug was fixed in source and committed through
  `6926721`; the gateway lifecycle owner guard was fixed in `da4d5f0`.
- Launchd is the sole current gateway owner: the service is loaded/running,
  has one launchd label, one service pid, and health is `ok:true` with
  `artist-runtime` loaded and Telegram connected.
- Previous full verification reported 377 files / 1746 tests passing;
  targeted independent checks for the final run, receipts, artifacts, commit
  presence, and gateway ownership passed here.

## Root fixes retained

- Test and write-smoke workspace isolation prevents mock records from reaching
  the production workspace or consuming the real weekly quota.
- Suno human-assist uses the authoritative CLI-authenticated profile and the
  current form selectors, including detached-button recovery.
- CLI failure diagnostics are metadata-only and do not expose argv, secrets,
  URLs, credentials, or local paths.
- Telegram delivery is proven by its append-only receipt ledger rather than by
  health or event emission alone.
- Gateway watcher credentials use the environment instead of long-lived argv;
  launchd ownership prevents a competing manual supervisor.

## Safety and scope

- CAPTCHA solving/bypass, payment prompts, login challenges, and social
  publishing were not automated.
- Runtime, config, state, and ledgers were not rewritten during this archive
  audit. No gateway restart, run-cycle, Telegram send, or API write was made.
- `git push` was not performed. Local commits remain ahead of origin.

## Commits

- `a590694` — watcher token argv exposure fix and boundary guard.
- `91b13d8` — align login with the CLI profile.
- `2cf3214` — avoid the macOS Chromium Safe Storage prompt.
- `030d11d` — current Suno form and detached-button recovery.
- `84054f7` — append-only Telegram delivery receipts.
- `6926721` — preserve accepted run identity during URL downloads.
- `da4d5f0` — guard gateway lifecycle ownership.
