# Handoff: restore autonomous Suno generation

Task ID: suno-root-fix-2026-08
Last updated: 2026-08-09 by implementer (artist-runtime.cc)
Status: in-progress — security item closed, generation still blocked

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

The security item is closed and verified. Generation has not yet reached a real
accepted/imported song. The mock contamination path is fixed in source and under
test; append-only runtime recovery and the browser A/B remain.

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

## Files changed

| File | Change |
|---|---|
| `scripts/openclaw-local-gateway-supervisor` | Pass the watcher token via environment, not `--token` |
| `scripts/openclaw-local-gateway` | Three `--token` sites kept, each behind a documented allow pragma |
| `scripts/boundary-grep.mjs` | New `secret-on-command-line` rule |
| `src/services/autopilotService.ts` | Resolve persisted config for config-less cycles |
| `scripts/openclaw-local-write-smoke.sh` | Force write requests into a disposable workspace |
| `tests/setup-workspace-isolation.ts` | Always replace inherited live workspace values |

Also dirty from separate work, deliberately not in `a590694`: `CHANGELOG.md`,
`docs/SUNO_BROWSER_DRIVER.md`, `tests/suno-cli-connector.test.ts`.

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
- Does human-assist need the external `:9222` browser, or does a plugin-owned
  browser work? Decide from a real page: URL, title, profile, visible form.

## Known risks

- Dry-run mock imports appear to consume the real weekly production quota. Until
  that is fixed, real generation stays blocked at `4/3`.
- Auto-memory claims the gateway is launchd-managed. It is not on this machine —
  LaunchAgent not loaded, launchd logs empty since Jul 26, nothing respawned
  during a 15s stop window. The memory is stale and will mislead the next agent.
- `gateway.pid` holds a stale pid (9149) while the live supervisor is 2235, so
  `status` prints `stopped` while `health` is `ok:true`. A plain `stop` will fall
  through to the `pkill` fallbacks.
- An internal transcript printed the old watcher token in full before masking
  discipline was in force. That token is now rotated and dead, but it argues for
  masking every process inspection from the start.

## Next actions

1. Recover the polluted count and song states without rewriting ledgers. Ledgers are append-only;
   use a correction entry or a supported cleanup path, never an in-place edit.
2. Run the browser A/B and record what the page actually shows.
3. Only then attempt a real create.

## Completion conditions

- [ ] A `dryRun:false` run reaches accepted/imported.
- [ ] Real Suno URLs, counted, no `mock://`.
- [ ] Telegram delivery confirmed from the ledger, not assumed.
- [ ] Mock runs cannot consume the real weekly quota, proven by a test.

## References

- Commit: `a590694`
- Guard rule: `scripts/boundary-grep.mjs` → `secret-on-command-line`
- Token validation: `src/routes/responseBuilders.ts:1839-1848`
- Tick path: `src/services/autopilotTicker.ts:186-224`
- Flaky test: `tests/suno-take-url-ready.test.ts` — fails under full-suite load,
  passes 3/3 in isolation. Timer-sensitive, unrelated to these changes.
