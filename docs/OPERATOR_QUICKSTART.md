# Operator Quickstart

This quickstart is the operator path from a fresh local checkout to a verified
dry-run and, later, an explicitly approved live social flow. It links back to
the detailed runbooks instead of repeating every recovery branch.

See also: [TROUBLESHOOTING.md](TROUBLESHOOTING.md),
[ERRORS.md](ERRORS.md), [API_ROUTES.md](API_ROUTES.md),
[CONNECTOR_AUTH.md](CONNECTOR_AUTH.md),
[SUNO_BROWSER_DRIVER.md](SUNO_BROWSER_DRIVER.md), and
[OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md).

> **Before you start:** confirm the prerequisites in the
> [README "Requirements" section](../README.md#requirements) — macOS, Node.js
> >= 20, a host `openclaw` CLI on `PATH`, and (for live lanes) the Playwright
> Chromium binary and the `bird` CLI.

## First-run onboarding (install → artist → first song)

This is the end-to-end path from a fresh install to a generated song. Each step
links to the detailed section that follows.

1. **Confirm prerequisites** — see the
   [README "Requirements" section](../README.md#requirements).
2. **Start the gateway** — [section 2](#2-start-the-gateway)
   (`openclaw gateway run ...`), then open the Producer Console at
   `http://127.0.0.1:43134/plugins/artist-runtime`.
3. **Create your artist persona** — the artist's identity, sound, and lyrics live
   in `ARTIST.md`. The shipped `ARTIST.md` is an **example** artist; replace it
   with your own. The fastest path is `/setup` in Telegram (set up Telegram in
   step 4 first), which writes the managed `ARTIST.md` block; you can also edit
   `ARTIST.md` directly. See
   [OPERATOR_RUNBOOK.md "First-run experience"](OPERATOR_RUNBOOK.md#first-run-experience-telegram-artist-persona).
4. **Connect Telegram (the control surface)** — Telegram is how you talk to the
   artist and approve songs. Create a bot with BotFather, set `TELEGRAM_BOT_TOKEN`
   and `TELEGRAM_OWNER_USER_IDS`, and set `telegram.enabled=true`. See
   [CONNECTOR_AUTH.md](CONNECTOR_AUTH.md) "Telegram bot opt-in" and
   [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md) "Telegram opt-in".
5. **Verify the mock dry-run** — run the
   [5-Minute First Cycle](#5-minute-first-cycle-mock-only-no-external-side-effects)
   below to confirm the Console and ticker work with zero external side effects.
6. **Set up the Suno lane** — install the browser binary and log in
   ([section 1 "Suno"](#suno)): `npx playwright install chromium`, then
   `scripts/openclaw-suno-login.sh`.
7. **Progress mock → live** — in the Producer Console **Settings** tab, switch
   `music.suno.driver` from `mock` to `playwright`, and `music.suno.submitMode`
   from `skip` to `live` (live consumes real Suno credits). See
   [SUNO_BROWSER_DRIVER.md](SUNO_BROWSER_DRIVER.md) "Dry-run vs live".
8. **Make a song** — with the artist set up and Suno live, the artist proposes
   songs from its own observations and asks you to approve in Telegram (tap the
   spawn proposal's GO button), or you send `/commission <idea>`. Autonomous
   spawn and `/commission` are gated behind environment flags set in the shell
   that launches the gateway:

   ```sh
   export OPENCLAW_SONG_SPAWN_ENABLED=on   # the artist proposes new songs itself
   export OPENCLAW_COMMISSION_ENABLED=on   # enables /commission <idea>
   ```

   Approve a proposal, and the autopilot generates takes via Suno and reports the
   result to Telegram. See OPERATOR_RUNBOOK.md for spawn/commission detail.

The sections below cover credentials, gateway start, probes, and the dry-run
safety boundary in detail.

## 5-Minute First Cycle (mock-only, no external side effects)

Use this section to confirm the Producer Console works end-to-end before
provisioning real Suno or X credentials. It exercises the UI, autopilot
ticker, and dry-run social path without touching live services.

1. Start the OpenClaw gateway with this plugin loaded. After installing the
   plugin into a host OpenClaw (`openclaw plugins install ...`), launch the
   gateway from the host:

   ```sh
   openclaw gateway run --allow-unconfigured --bind loopback --auth none --port 43134
   ```

   The plugin activates on startup (`activation.onStartup`), so the Producer
   Console route comes up with the gateway. Keep `--bind loopback` so the
   gateway is reachable only from this machine; see
   [GATEWAY_AUTH.md](GATEWAY_AUTH.md) to use a gateway token instead of
   `--auth none`.

   > Contributors working from a repository clone can use the repo-local
   > sandbox wrapper instead, which pins an isolated `.local/openclaw` home and
   > the same port: `scripts/openclaw-local-gateway start`. This wrapper is not
   > part of the published package.

2. Open the Producer Console in a browser:

   ```
   http://127.0.0.1:43134/plugins/artist-runtime
   ```

3. The Dashboard's "Last Cycle Summary" card pins the current state. With a
   fresh workspace it shows `Autopilot Stage: idle` and zero artifacts.

4. Open Settings (tab in Producer Console) and:
   - turn on `Autopilot enabled` and `Dry-run safety`
   - leave `Suno Driver` on `mock` and `Suno Submit Mode` on `skip`
   - click `Save Settings`

5. Return to Dashboard and click `Run Cycle` on the Last Cycle Summary card.
   The autopilot advances through `planning` -> `prompt_pack` ->
   `suno_generation`. It stops at `suno_generation` with
   `blockedReason: waiting for Suno result import`. This is intentional:
   `submitMode: skip` deliberately avoids the Suno Create click, so no song
   URLs are produced and there is nothing to import. The mock-only lane is
   for verifying the UI, ticker, and dry-run social path; it does not
   advance further on its own.

6. To see the X dry-run reply enrichment in action, open the Platforms tab
   and use the Reply Simulation form (or POST to
   `/api/platforms/x/simulate-reply`). The ledger captures `mentionedHandles`
   and `tweetId` without contacting the X API.

7. Skipped cycles are visible: clicking `Run Cycle` while one is in flight
   shows `skipped:concurrent` in a yellow banner; toggling Autopilot off and
   re-clicking shows `skipped:disabled` in a red banner.

To advance through `take_selection`, `asset_generation`, and `publishing`
the operator must switch `Suno Submit Mode` to `live` and complete the Suno
login lane (`scripts/openclaw-suno-login.sh`). Switching to `live`
consumes real Suno credits per cycle; the inline warning under the dropdown
is a reminder. The `Suno Driver` select can stay on `mock` for harness-only
exercises, but real Suno generation requires `playwright` plus a live
browser session.

If any step alerts something other than zero, follow
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) before continuing to the
credentialed sections below.

## 0. Preconditions

- Work from the package root — the directory holding the installed plugin's
  tarball contents (`docs/`, the operator `scripts/`, `package.json`). The
  helper scripts below are run from there.
- Keep `.local/`, `runtime/`, `.env*`, and `.openclaw-browser-profiles/` local.
- Keep `autopilot.dryRun` enabled until the operator has verified the status
  surfaces and granted a separate live GO.
- Treat Instagram and TikTok as frozen lanes. The feature skeletons stay in the
  package, but the operator does not provision tokens or exercise probes for
  those lanes.

If any credential, profile, or runtime artifact appears in a PR, log, screenshot,
or chat transcript, stop and use
[TROUBLESHOOTING.md#credential-or-profile-exposure-concern](TROUBLESHOOTING.md#credential-or-profile-exposure-concern).

## 1. Prepare local credentials and profiles

### X / Bird

1. Sign in to the artist X account through Bird's supported local browser
   profile.
2. If the artist account uses a dedicated Firefox profile, put only the profile
   basename in `.local/social-credentials.env`:

   ```sh
   BIRD_FIREFOX_PROFILE=profile-basename
   ```

3. Export `OPENCLAW_X_FIREFOX_PROFILE` with that profile basename in the shell
   that launches the gateway, so runtime Bird calls use the artist profile:

   ```sh
   export OPENCLAW_X_FIREFOX_PROFILE=profile-basename
   ```

   (Contributors running the repo-local sandbox can instead source
   `scripts/openclaw-local-env.sh`, which exports it automatically.)
4. Confirm the selected account outside the plugin:

   ```sh
   bird --firefox-profile "$OPENCLAW_X_FIREFOX_PROFILE" whoami --plain
   ```

Expected success: the artist `@handle` is returned.

If this fails, use [TROUBLESHOOTING.md#x-probe-red](TROUBLESHOOTING.md#x-probe-red)
and the X section of [CONNECTOR_AUTH.md#x-bird](CONNECTOR_AUTH.md#x-bird).

### Suno

1. Install the browser binary on the operator machine when needed:

   ```sh
   npx playwright install chromium
   ```

2. Run the manual login helper:

   ```sh
   scripts/openclaw-suno-login.sh
   ```

3. Complete Google OAuth manually and close the browser after the authenticated
   Suno surface loads.

Expected success: the dedicated profile remains under
`.openclaw-browser-profiles/suno/`.

If login or profile startup fails, use
[TROUBLESHOOTING.md#suno-profile-stale-or-corrupt](TROUBLESHOOTING.md#suno-profile-stale-or-corrupt)
and [SUNO_BROWSER_DRIVER.md#operator-recovery](SUNO_BROWSER_DRIVER.md#operator-recovery).

### Instagram and TikTok

Do not provision new Instagram or TikTok credentials. Both lanes are frozen by
operator decision. Their existing skeletons remain test-covered and fail-closed.

If a frozen-lane event appears, use
[TROUBLESHOOTING.md#igtiktok-frozen-attempt](TROUBLESHOOTING.md#igtiktok-frozen-attempt).

## 2. Start the Gateway

Launch the OpenClaw gateway from the host install with the plugin loaded:

```sh
openclaw gateway run --allow-unconfigured --bind loopback --auth none --port 43134
```

Expected success: the gateway reports a running process and the plugin API
responds. Confirm the plugin route is up:

```sh
curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/status
```

`--bind loopback` keeps the gateway reachable only from this machine. To run
with a gateway token instead of `--auth none`, see
[GATEWAY_AUTH.md](GATEWAY_AUTH.md).

If the Gateway does not start, use
[TROUBLESHOOTING.md#gateway-startup-failure](TROUBLESHOOTING.md#gateway-startup-failure).

> Contributors working from a repository clone can use the repo-local sandbox
> wrapper, which sources `scripts/openclaw-local-env.sh` and pins an isolated
> `.local/openclaw` home: `scripts/openclaw-local-gateway start` plus
> `scripts/openclaw-local-gateway status`. These wrappers are not part of the
> published package.

## 3. Verify probes

Use the platform test routes cataloged in
[API_ROUTES.md#platform-test-route-anchors](API_ROUTES.md#platform-test-route-anchors).

### X probe

```sh
curl -sS -X POST http://127.0.0.1:43134/plugins/artist-runtime/api/platforms/x/test
```

Expected success:

- `connected: true`
- `accountLabel` matches the artist account
- `authStatus: "tested"`
- `lastTestedAt` is persisted in config overrides

If the reason is `bird_cli_not_installed`, `bird_auth_expired`, or
`bird_probe_failed`, use [ERRORS.md#bird_probe_failed](ERRORS.md#bird_probe_failed)
and [TROUBLESHOOTING.md#x-probe-red](TROUBLESHOOTING.md#x-probe-red).

### Suno status

```sh
curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/suno/status
curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/status
```

Expected success:

- Suno worker status is visible
- `suno.budget.remaining` is non-negative
- `suno.profile.stale` is absent or `false`

If budget is exhausted, use
[TROUBLESHOOTING.md#suno-budget-exhausted](TROUBLESHOOTING.md#suno-budget-exhausted).
If the profile is stale, use
[TROUBLESHOOTING.md#suno-profile-stale-or-corrupt](TROUBLESHOOTING.md#suno-profile-stale-or-corrupt).

## 4. Review arm flags

Artist Runtime uses multiple social guards:

- `autopilot.dryRun`
- `distribution.enabled`
- `distribution.liveGoArmed`
- `distribution.platforms.<platform>.enabled`
- `distribution.platforms.<platform>.liveGoArmed`
- connector edge checks such as
  [ERRORS.md#requires_explicit_live_go](ERRORS.md#requires_explicit_live_go)

The status surface exposes the effective result:

```sh
curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/status
```

Expected dry-run setup state:

- `summary.allPlatformsEffectivelyDryRun: true`
- X can be probed and staged
- Instagram and TikTok remain frozen

If the dry-run banner stays on unexpectedly, use
[TROUBLESHOOTING.md#dry-run-banner-stays-on](TROUBLESHOOTING.md#dry-run-banner-stays-on).

## 5. Confirm a dry-run action

Use Producer Console or the API to simulate an X reply. This must remain
dry-run:

```sh
curl -sS -X POST http://127.0.0.1:43134/plugins/artist-runtime/api/platforms/x/simulate-reply \
  -H 'content-type: application/json' \
  --data '{"targetId":"1900000000000000000","text":"dry-run check"}'
```

Expected success:

- response contains a dry-run result
- no public reply is posted
- the social ledger records reply-target audit metadata

If config patching or dry-run action calls fail, use
[TROUBLESHOOTING.md#config-patch-failure](TROUBLESHOOTING.md#config-patch-failure)
or [TROUBLESHOOTING.md#x-probe-red](TROUBLESHOOTING.md#x-probe-red).

## 6. Live publish flow

Live social publishing is not enabled by this quickstart. The operator must make
a separate explicit GO before any lane changes from fail-closed rehearsal to
real publish.

Before that GO:

1. Confirm X probe shows the artist account.
2. Confirm dry-run ledger entries look correct.
3. Confirm `distribution.liveGoArmed` and the X platform arm are intentionally
   set.
4. Confirm the connector edge still rejects accidental live attempts with
   [ERRORS.md#requires_explicit_live_go](ERRORS.md#requires_explicit_live_go).
5. Keep Instagram and TikTok frozen.

Rollback path: use `scripts/reset-config.sh` and the operator notes in
[OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md) if a config experiment needs to be
discarded.

## 7. Operator maintenance helpers

Run the doctor after setup and after any recovery:

```sh
scripts/openclaw-doctor.sh
scripts/openclaw-doctor.sh --json
```

For local state maintenance:

```sh
scripts/rotate-runtime-logs.sh --dry-run
scripts/snapshot-runtime-state.sh --dry-run
scripts/runtime-disk-usage.sh --json
```

See [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md) for script details and cron
examples. If disk pressure appears, use
[TROUBLESHOOTING.md#disk-usage-warning](TROUBLESHOOTING.md#disk-usage-warning)
and [RUNTIME_CLEANUP.md](RUNTIME_CLEANUP.md).

## 8. Where to go next

- Route catalog: [API_ROUTES.md](API_ROUTES.md)
- Connector setup: [CONNECTOR_AUTH.md](CONNECTOR_AUTH.md)
- Suno browser lane: [SUNO_BROWSER_DRIVER.md](SUNO_BROWSER_DRIVER.md)
- Reason-code catalog: [ERRORS.md](ERRORS.md)
- Symptom decision tree: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
