# Troubleshooting

This decision tree starts from symptoms visible to an operator. It links into
the reason-code catalog instead of asking the operator to guess which subsystem
failed.

See also: [ERRORS.md](ERRORS.md), [OPERATOR_QUICKSTART.md](OPERATOR_QUICKSTART.md),
[API_ROUTES.md](API_ROUTES.md), [CONNECTOR_AUTH.md](CONNECTOR_AUTH.md),
[SUNO_BROWSER_DRIVER.md](SUNO_BROWSER_DRIVER.md), and
[OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md).

> **Repo-local vs. installed-plugin commands.** Commands in this document that
> use `scripts/openclaw-local-*` are the contributor repository sandbox wrappers
> and are **not** included in the published package. If you installed the plugin,
> use the host equivalents:
>
> - `scripts/openclaw-local-gateway start` / `status` → `openclaw gateway run --allow-unconfigured --bind loopback --auth none --port 43134` (see [OPERATOR_QUICKSTART.md](OPERATOR_QUICKSTART.md))
> - `scripts/openclaw-local-env.sh` → repo-only; export the documented environment variables directly in your shell
> - `scripts/openclaw-local-http-smoke.sh` → `curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/status`

## Decision tree overview

1. Is the Gateway reachable?
   - No: go to [Gateway startup failure](#gateway-startup-failure).
   - Yes: continue.
2. Is the symptom on a social platform card or probe?
   - X: go to [X probe red](#x-probe-red).
   - Instagram or TikTok frozen: go to [IG/TikTok frozen attempt](#igtiktok-frozen-attempt).
3. Is the symptom on the Suno or budget card?
   - Budget: go to [Suno budget exhausted](#suno-budget-exhausted).
   - Profile: go to [Suno profile stale or corrupt](#suno-profile-stale-or-corrupt).
4. Is the symptom in the Producer Console network/config layer?
   - Config update: go to [Config patch failure](#config-patch-failure).
   - Offline/stale banner: go to [Connection lost or stale console](#connection-lost-or-stale-console).
5. Is local storage growing or cleanup warning?
   - Go to [Disk usage warning](#disk-usage-warning).

## Gateway startup failure

Common symptoms:

- `scripts/openclaw-local-gateway status` reports stopped
- `scripts/openclaw-local-http-smoke.sh` cannot reach the plugin
- Producer Console never loads

Likely causes:

- Gateway process is not running
- stale port or workspace path
- local env was not sourced before launch

Verify:

```sh
scripts/openclaw-local-gateway status
scripts/openclaw-local-gateway tail
scripts/openclaw-doctor.sh --json
```

Recovery:

1. Source `scripts/openclaw-local-env.sh`.
2. Start the Gateway with `scripts/openclaw-local-gateway start`.
3. Run `scripts/openclaw-local-http-smoke.sh`.
4. If the error mentions gateway/plugin auth, read
   [GATEWAY_AUTH.md#troubleshooting-token-mismatch](GATEWAY_AUTH.md#troubleshooting-token-mismatch)
   and [ERRORS.md#gateway_token_mismatch](ERRORS.md#gateway_token_mismatch).

## X probe red

Common symptoms:

- X platform card shows `bird_cli_not_installed`
- X platform card shows `bird_auth_expired`
- X platform card shows `bird_probe_failed`
- `POST /api/platforms/x/test` does not show the artist account

Likely causes:

- `bird` is not on the Gateway `PATH`
- the dedicated Firefox profile is not exported through
  `OPENCLAW_X_FIREFOX_PROFILE`
- Bird can read a default personal profile but not the artist profile
- Firefox cookie storage cold-read exceeded the old timeout budget

Verify:

```sh
command -v bird
echo "$OPENCLAW_X_FIREFOX_PROFILE"
bird --firefox-profile "$OPENCLAW_X_FIREFOX_PROFILE" whoami --plain
```

Recovery:

1. Confirm the artist account outside the plugin.
2. Source `scripts/openclaw-local-env.sh`.
3. Restart the local Gateway from that shell.
4. Re-run
   [POST /api/platforms/x/test](API_ROUTES.md#post-apiplatformsxtest).
5. Use the reason-code catalog:
   [bird_cli_not_installed](ERRORS.md#bird_cli_not_installed),
   [bird_auth_expired](ERRORS.md#bird_auth_expired), or
   [bird_probe_failed](ERRORS.md#bird_probe_failed).

## Suno budget exhausted

Common symptoms:

- live create returns [budget_exhausted](ERRORS.md#budget_exhausted)
- live create returns
  [budget_exhausted_monthly](ERRORS.md#budget_exhausted_monthly)
- Producer Console budget card shows zero remaining credits

Likely causes:

- daily limit reached for the UTC date
- optional monthly limit reached
- operator lowered `dailyCreditLimit` or `monthlyCreditLimit`

Verify:

```sh
curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/status
```

Recovery:

1. Prefer the Producer Console budget card over manual file inspection.
2. Raise the config limit only if the operator has approved the spend.
3. Use the confirmed `Reset budget` button only when the operator wants to
   reopen the current UTC day.
4. If manual state inspection is unavoidable, follow
   [SUNO_BROWSER_DRIVER.md#editing-budgetjson](SUNO_BROWSER_DRIVER.md#editing-budgetjson).

## Suno profile stale or corrupt

Common symptoms:

- Producer Console shows a stale Suno profile banner
- Suno probe shows login required after a working session
- browser profile cannot launch
- repeated profile-backed probes fail

Likely causes:

- Google OAuth session expired
- profile was copied between users or machines
- profile storage is corrupt or unreadable
- profile has not been touched for the stale threshold

Verify:

```sh
scripts/suno-profile-diagnose.sh
```

Recovery:

1. For normal reauthentication, use
   [SUNO_BROWSER_DRIVER.md#scenario-b-google-oauth-reauthentication-required](SUNO_BROWSER_DRIVER.md#scenario-b-google-oauth-reauthentication-required).
2. For corruption, use
   [SUNO_BROWSER_DRIVER.md#scenario-a-profile-corruption](SUNO_BROWSER_DRIVER.md#scenario-a-profile-corruption).
3. Keep profile snapshots local and never attach them to incidents.

## Config patch failure

Common symptoms:

- Producer Console Save Settings fails
- error toast source is `config-patch`
- `/api/config/update` returns a non-2xx response

Likely causes:

- invalid value rejected by config schema
- config file cannot be read or written
- stale Gateway environment points at a different workspace

Verify:

```sh
curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/config
scripts/openclaw-doctor.sh --json
```

Recovery:

1. Re-open the Config Editor and check numeric ranges.
2. If config appears corrupt, use `scripts/reset-config.sh` after reviewing its
   backup behavior in [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md).
3. Check [ERRORS.md#gateway_token_mismatch](ERRORS.md#gateway_token_mismatch)
   if the Gateway boundary is involved.

## Connection lost or stale console

Common symptoms:

- Producer Console shows offline, reconnecting, recovered, or stale banners
- error toast source is `network`
- status refresh exceeds the 10 second timeout

Likely causes:

- Gateway process stopped or restarted
- network call timed out
- local machine slept or throttled the browser tab

Verify:

```sh
scripts/openclaw-local-gateway status
scripts/openclaw-doctor.sh --json
```

Recovery:

1. Let the Console retry once; recovered state should clear automatically.
2. If still offline, inspect Gateway status and tail logs.
3. If the Gateway is healthy but the UI stays stale, refresh the browser tab.

## Disk usage warning

Common symptoms:

- doctor reports runtime disk warning or failure
- imported Suno artifacts are growing under `runtime/suno/`
- cleanup scripts list many old candidates

Likely causes:

- retained Suno artifacts
- old social ledger archives
- prompt-ledger retention window

Verify:

```sh
scripts/runtime-disk-usage.sh --json
scripts/cleanup-runtime.sh --dry-run
scripts/runtime-retention-enforce.sh --dry-run
```

Recovery:

1. Review the candidate list before deleting anything.
2. Use [RUNTIME_CLEANUP.md](RUNTIME_CLEANUP.md) for retention policy.
3. Remember that deleting artifacts does not reset Suno budget counters.

## IG/TikTok frozen attempt

Common symptoms:

- `account_not_created`
- `tiktok_account_not_created`
- Instagram lane remains frozen by operator decision
- TikTok probe button is disabled

Likely causes:

- expected frozen-lane behavior
- operator attempted to inspect a lane that is intentionally not active

Recovery:

1. Do not create new Instagram or TikTok setup steps.
2. Keep those lanes disabled and fail-closed.
3. For reason-code context, use
   [ERRORS.md#account_not_created](ERRORS.md#account_not_created) and
   [ERRORS.md#tiktok_account_not_created](ERRORS.md#tiktok_account_not_created).

## Dry-run banner stays on

Common symptoms:

- Producer Console says all platforms are effectively dry-run
- social publish returns
  [dry-run blocks social publish](ERRORS.md#dry-run-blocks-social-publish)
- connector edge returns
  [requires_explicit_live_go](ERRORS.md#requires_explicit_live_go)

Likely causes:

- `autopilot.dryRun` is still true
- `distribution.enabled` or platform enablement is false
- global or platform `liveGoArmed` is false
- connector edge is still fail-closed

Verify:

```sh
curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/status
```

Recovery:

1. Treat the banner as safe-by-default unless the operator explicitly intends a
   later live lane.
2. Confirm the platform account and dry-run ledger first.
3. Do not bypass [requires_explicit_live_go](ERRORS.md#requires_explicit_live_go)
   without a separate operator GO.

## Credential or profile exposure concern

Common symptoms:

- token-like text appears in a log, PR, screenshot, or chat transcript
- `.local/`, `.env`, runtime state, or browser profile data appears outside the
  operator machine

Likely causes:

- manual copy/paste mistake
- over-broad archive or screenshot
- package artifact included a local path

Recovery:

1. Stop sharing the affected artifact.
2. Rotate the exposed credential or rebuild the exposed browser profile.
3. Use [INCIDENT_RESPONSE.md#safe-incident-notes](INCIDENT_RESPONSE.md#safe-incident-notes)
   for what may be recorded.
4. Check [PACKAGE_CONTENTS.md#excluded-paths-for-distribution](PACKAGE_CONTENTS.md#excluded-paths-for-distribution)
   before packaging again.
