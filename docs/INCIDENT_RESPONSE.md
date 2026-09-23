# Incident Response

This runbook is for operator recovery when Artist Runtime stops behaving like a
normal dry-run or live-lane workflow. Keep incidents small: identify the surface,
freeze side effects, collect status, and only then repair.

See also: `docs/ERRORS.md` for reason-code anchors and operator recovery links.

## Triage matrix

| Symptom | First surface | Immediate action | Primary doc |
| --- | --- | --- | --- |
| Suno browser crashes, launch fails, or probe collapses repeatedly | Producer Console Suno card / `/api/suno/status` | Pause the lane, keep the profile local, inspect browser-profile recovery steps | `docs/SUNO_BROWSER_DRIVER.md` |
| Budget state looks wrong or live create returns `budget_exhausted` | Producer Console budget card / `/api/status` | Do not edit during a write; compare visible state with `runtime/suno/budget.json` guidance | `docs/SUNO_BROWSER_DRIVER.md` |
| Publish or reply is stuck in dry-run / blocked | Producer Console Platforms / Status | Check global arm, platform arm, platform enablement, and connector reason before changing credentials | `docs/CONNECTOR_AUTH.md` |
| Browser profile appears corrupt or migrated profile fails | Suno login probe | Back up the profile directory, rebuild or reauthenticate manually, then probe again | `docs/SUNO_BROWSER_DRIVER.md` |

## Scenario 1: Suno crash or browser lane collapse

1. Pause autopilot from Producer Console if it is running.
2. Check `/api/suno/status` and record only state, reason, run id, and timestamp.
   Do not copy profile cookies, screenshots, or browser storage.
3. If the issue is login-related, follow `docs/SUNO_BROWSER_DRIVER.md` Scenario B.
4. If the browser profile will not launch or repeatedly fails after retry,
   follow the profile-corruption flow in `docs/SUNO_BROWSER_DRIVER.md`.
5. Re-run the Suno probe and require a connected state before resuming live
   `submitMode`.

## Scenario 2: budget anomaly

1. Compare Producer Console `date / consumed / limit / remaining` with the
   operator's expected current UTC day.
2. If the cap is too low, change `music.suno.dailyCreditLimit` through Config
   Editor.
3. If the counter should reopen immediately, use the confirmed `Reset budget`
   action in Producer Console.
4. If manual file inspection is required, follow `Editing budget.json` in
   `docs/SUNO_BROWSER_DRIVER.md`; keep JSON valid and avoid editing while the
   runtime may be writing.
5. Retry live create only after `remaining` is positive.

## Scenario 3: publish stuck or connector blocked

1. Confirm whether the pipeline is held by `autopilot.dryRun`,
   `distribution.enabled`, `distribution.liveGoArmed`, the platform-specific
   arm, or the platform enablement toggle.
2. Run the relevant platform health check from Producer Console or
   `POST /plugins/artist-runtime/api/platforms/{id}/test`.
3. If the connector reports expired or missing credentials, follow the token
   expiry reaction flow in `docs/CONNECTOR_AUTH.md`.
4. Keep real publish blocked until the connector-specific edge reason has been
   resolved and the operator has explicitly armed that platform.

## Scenario 4: profile corruption or migration failure

1. Stop the local Gateway/runtime before touching the profile.
2. Rename `.openclaw-browser-profiles/suno/` to a backup path. Do not delete it
   first.
3. Rebuild or migrate the profile using `docs/SUNO_BROWSER_DRIVER.md`.
4. Complete manual Google OAuth login only through the operator-run login helper.
5. Probe again and require connected status before trusting the rebuilt profile.

## Failure injection checklist

Use these tests before a release candidate or after changing the autopilot,
Telegram, or Suno control surfaces. Keep all injections local/mock unless a
separate operator GO explicitly opens a live lane.

| Injection | How to trigger safely | Expected fail-closed behavior | Recovery |
| --- | --- | --- | --- |
| Suno auth expired | Set the mock worker/profile state to `login_required` or use the Suno probe fixture | Autopilot blocks before live create; status surfaces login-required state | Follow `docs/SUNO_BROWSER_DRIVER.md` Scenario B |
| Network error | Use mock fetch/connector failure in Telegram or social dry-run tests | Worker reports an error/backoff; process does not crash; no real network retry loop | Restore mock success and rerun the route/test |
| Take count zero | Seed a song with empty `latest-results.json` / no selected take | `/review` returns a mock or safe debug result without changing `selected-take.json` | Re-import takes or rerun the dry-run Suno import path |
| Telegram bot failure | Run worker tests with a failing mock fetch or missing owner allowlist | Worker stays disabled or backs off; no unhandled exception; tokens stay unlogged | Re-enable the three Telegram opt-in gates and rerun `/status` |

## Safe incident notes

Allowed in incident notes:

- timestamps
- route names
- high-level reasons such as `login_required`, `budget_exhausted`, or
  `requires_explicit_live_go`
- run ids and song ids
- redacted URLs when needed for operator correlation

Forbidden in incident notes:

- cookies, tokens, API keys, OAuth refresh tokens, browser storage bodies
- raw request or response bodies from platform providers
- screenshots that show signed-in account pages or profile internals
- contents of `.local/`, `.env`, or `.openclaw-browser-profiles/suno/`
