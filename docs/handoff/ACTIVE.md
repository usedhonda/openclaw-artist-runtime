# Handoff: restore autonomous Suno generation

Task ID: suno-root-fix-2026-08
Last updated: 2026-08-09 by implementer (artist-runtime.cdx)
Status: in-progress — source recovery verified; live session rotation required

## Objective

Get autonomous Suno generation producing and importing a real song again. A
credential exposure found on the way had to be closed first.

## Scope

- Close the ticker-watcher token exposure and rotate the secret.
- Find why real generation is blocked and fix the root cause.
- Prove recovery with a real (non-dry-run) accepted/imported song.

## Explicitly out of scope

- CAPTCHA automation or bypass of any kind.
- Restoring the normal-live dead-endpoint preflight that `5415a3f` removed.
- `git push` — commits stay local until the owner lifts this.
- Changing the weekly-limit rule itself if it is a genuine internal-song contract.
  Fix the path that polluted the count, not the rule.

## Current state

The watcher-token incident is closed and verified. Generation has not yet reached
a real accepted/imported song. Mock contamination, quota state, browser profile
selection, current-form selectors, detached-button recovery, CLI failure logging,
and Telegram delivery evidence are repaired in source and covered by tests. A live
create is deliberately blocked until the operator invalidates the exposed Suno
session and signs the dedicated profile in again. No Suno browser is running.

## Completed

- [x] Confirmed the exposure independently — a 48-char token sat in the live
      watcher's `ps`-readable arguments.
- [x] Fixed the channel — the supervisor now hands the token to the watcher
      through the environment. Commit `a590694` (not pushed).
- [x] Added a `boundary-grep` rule for secrets on the command line, which
      immediately found three more sites in the gateway wrapper.
- [x] Rotated the token via one clean stop/start with both token vars unset.
      Masked evidence: `19...b1` → `4f...9b`, both 48 chars.
- [x] Verified after restart: watcher arguments carry no token, old watcher gone,
      `health ok:true`, `telegram.connected:true`, no 401/403.
- [x] Ruled out `openclaw-local-write-smoke.sh` as the observed 18:05Z writer:
      its mandatory config update would have changed `config-overrides.json`, whose
      mtime remained 17:51Z; no config audit entry was appended.
- [x] Ruled out the two 18:17Z/18:19Z full Vitest runs as additional writers:
      the live workspace had zero changed files from 18:17Z through 18:25Z.
- [x] Fixed the two proven write boundaries: config-less `runCycle()` now resolves
      the workspace's persisted config, and both write-smoke and Vitest force a
      disposable workspace even when the launching shell exports the live root.
- [x] Closed the second Vitest escape discovered during verification: tests that
      delete `OPENCLAW_LOCAL_WORKSPACE` now fall back to a dedicated test root,
      never the repository's default live path. Focused 29-test verification left
      the live autopilot state and runtime-events ledger byte-for-byte unchanged.
- [x] Recovered mock-contaminated mutable state through supported services: discarded
      `spawn_dffb16` and `song-077`, returned `spawn_3e607c` to `suno_prompt_pack`,
      removed mock URLs, appended a correction audit per song, and preserved every
      append-only Suno runs ledger. A recovery backup was created first.
- [x] Ran the browser A/B without form input or submit. External `:9222` and the
      plugin-owned browser both used `.openclaw-browser-profiles/suno`, redirected
      `/create` to `/`, and exposed zero create-form selectors. That profile has zero
      Suno `__session` cookies. The CLI login profile at
      `runtime/suno/cli/browser-profile` has two unexpired `__session` cookies, while
      the saved CLI session independently returned `audio_ready` from the Suno API.
- [x] Fixed human assist to default to the CLI-authenticated browser profile while
      retaining explicit `browser.profileDir` and CDP overrides. The new regression
      test failed before the helper existed and now passes.
- [x] Verified the current Suno form without submit: lyrics, style, title, exclude,
      and Create were all visible and reflected the real `spawn_3e607c` payload.
- [x] Fixed the live `suno_create_dom_missing` regression found afterward: the driver
      now accepts current plain Advanced/Create buttons, selects Custom, hydrates from
      the CLI session, preserves duplicate/domain cookie scopes, and retries detached
      React buttons. Commit `030d11d`; targeted 49 tests, typecheck, lint, and
      boundary-grep passed.
- [x] Removed raw `suno-cli` argv from create/download failure logs. Diagnostics now
      keep only safe run ids, field lengths, target kind, and exit code; regression
      tests proved titles, lyrics, prompts, URLs, credentials, and local paths stay out.
- [x] Added append-only `runtime/telegram-deliveries.jsonl` success receipts. A
      completed-song test proves Telegram's returned message id is persisted without
      message text, URLs, chat ids, or tokens, so delivery no longer depends on health
      or event-emission inference.

## Files changed

| File | Change |
|---|---|
| `scripts/openclaw-local-gateway-supervisor` | Pass the watcher token via environment, not `--token` |
| `scripts/openclaw-local-gateway` | Three `--token` sites kept, each behind a documented allow pragma |
| `scripts/boundary-grep.mjs` | New `secret-on-command-line` rule |
| `src/services/autopilotService.ts` | Resolve persisted config for config-less cycles |
| `scripts/openclaw-local-write-smoke.sh` | Force write requests into a disposable workspace |
| `tests/setup-workspace-isolation.ts` | Always replace inherited live workspace values |
| `src/connectors/suno/humanAssistSunoConnector.ts` | Reuse the CLI login profile for human assist |
| `src/connectors/suno/resolveSunoConnector.ts` | Pass the authoritative workspace root into human assist |
| `src/connectors/suno/cliSunoConnector.ts` | Replace raw failure argv with metadata-only context |
| `src/services/telegramDeliveryLedger.ts` | Append metadata-only Telegram success receipts |
| `src/services/telegramNotifier.ts` | Record receipts after Telegram accepts a signal message |

## Decided (do not relitigate)

| Decision | Reason |
|---|---|
| The watcher token goes through the environment | Process arguments are world-readable via `ps`; the watcher is long-lived |
| The three gateway-wrapper `--token` sites stay | With `--url` overridden the CLI demands explicit credentials, and `gateway health` rejects `--token-file`. Both upstream-suggested alternatives were tried and both fail. One-shot processes, exposure window far smaller than a daemon |
| Exceptions are recorded as visible pragmas | An auditable exception beats silently reshaping code to dodge the scanner |
| No forced safe-tick trigger to manufacture an `http=200` | An unpaused trigger calls `runCycle`, a real pipeline advance. Evidence is not worth causing a public side effect |
| Rotation means restart, not editing stored copies | The token is minted fresh at launcher time and never persisted |

## Rejected alternatives

| Option | Why rejected |
|---|---|
| `OPENCLAW_GATEWAY_TOKEN` for the wrapper | `GatewayExplicitAuthRequiredError: gateway url override requires explicit credentials` |
| `--token-file` for the wrapper | `OpenClaw does not recognize option "--token-file"` for `gateway health` |
| Leaving the wrapper broken to keep the scanner clean | Breaks operator tooling for a cosmetic pass |

## Open questions

- The exact initiating process for the 18:05Z write is not retained in runtime
  audit data. The recorded default/mock config proves a config-less/defaulted
  cycle reached the live root; the service and test boundaries that permitted
  that state are now covered by regression tests.

## Known risks

- A diagnostic printed a Suno Clerk handshake query containing session material to
  an internal tool transcript. The browser was killed and autopilot was paused with
  `security:suno_session_rotation_required`; the affected session must be invalidated
  before another live browser or create attempt.
- A later overly broad local-profile search printed browser preference metadata to
  an internal tool transcript. No cookie/password contents were read, but it reinforces
  the same required session invalidation and dedicated-profile rebuild.
- Auto-memory claims the gateway is launchd-managed. It is not on this machine —
  LaunchAgent not loaded, launchd logs empty since Jul 26, nothing respawned
  during a 15s stop window. The memory is stale and will mislead the next agent.
- `gateway.pid` holds a stale pid (9149) while the live supervisor is 2235, so
  `status` prints `stopped` while `health` is `ok:true`. A plain `stop` will fall
  through to the `pkill` fallbacks.
- An internal transcript printed the old watcher token in full before masking
  discipline was in force. That token is now rotated and dead, but it argues for
  masking every process inspection from the start.
- The first full-suite verification in this recovery recalculated live autopilot
  state as `8/3` after a test deleted the primary workspace env. No new song was
  created, but the live state write proved the initial test isolation was incomplete;
  the dedicated fallback root above is the corrective guard.

## Next actions

1. Operator invalidates all Suno sessions, then signs the dedicated CLI profile in
   again. Do not inspect or reuse the old profile/session material.
2. Rebuild/restart the manual gateway once on the latest commits and clear only the
   security pause through the supported autopilot state service.
3. Run one real create, import its real URLs/audio, and match the completed-song
   Telegram message id in `runtime/telegram-deliveries.jsonl`.

## Completion conditions

- [ ] A `dryRun:false` run reaches accepted/imported.
- [ ] Real Suno URLs, counted, no `mock://`.
- [ ] Telegram delivery confirmed from the ledger, not assumed.
- [x] Mock runs cannot consume the real weekly quota, proven by a test.

## References

- Commit: `a590694`
- Guard rule: `scripts/boundary-grep.mjs` → `secret-on-command-line`
- Token validation: `src/routes/responseBuilders.ts:1839-1848`
- Tick path: `src/services/autopilotTicker.ts:186-224`
- Flaky test: `tests/suno-take-url-ready.test.ts` — fails under full-suite load,
  passes 3/3 in isolation. Timer-sensitive, unrelated to these changes.
