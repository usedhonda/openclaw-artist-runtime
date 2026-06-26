# Connector Auth Guide

This document is the operator-facing reference for connector credential setup,
refresh, and health checks.

Use it together with:

- `CAPABILITIES.md` for connector scope and fail-closed behavior
- `SECURITY.md` for secret handling requirements
- `PRIVACY.md` for local-only credential storage boundaries
- `PUBLISHING.md` for release/package checklist items
- `docs/GATEWAY_AUTH.md` for the HTTP/gateway boundary around these connector checks
- `docs/API_ROUTES.md` for the plugin HTTP surface
- `docs/SUNO_BROWSER_DRIVER.md` for the separate Suno browser-profile lane
- `docs/OPERATOR_QUICKSTART.md` for the end-to-end operator setup path
- `docs/TROUBLESHOOTING.md` for symptom-first recovery flows
- `docs/ERRORS.md` for reason-code meanings and recovery anchors

> **Repo-local vs. installed-plugin commands.** Commands in this document that
> use `scripts/openclaw-local-*` are the contributor repository sandbox wrappers
> and are **not** included in the published package. If you installed the plugin,
> use the host equivalents:
>
> - `scripts/openclaw-local-gateway start` / `status` → `openclaw gateway run --allow-unconfigured --bind loopback --auth none --port 43134` (see [OPERATOR_QUICKSTART.md](OPERATOR_QUICKSTART.md))
> - `scripts/openclaw-local-env.sh` → repo-only; export the documented environment variables directly in your shell
> - `scripts/openclaw-local-http-smoke.sh` → `curl -sS http://127.0.0.1:43134/plugins/artist-runtime/api/status`

## Shared rules

- Do not paste secrets into Prompt Ledgers, audit logs, workspace files, package
  artifacts, screenshots, or repository docs.
- Check connector state from Producer Console `Platforms` and `Status` before
  retrying any live distribution action.
- Social live arming now has two levels:
  - `distribution.liveGoArmed`
  - `distribution.platforms.{x,instagram,tiktok}.liveGoArmed`
- Both flags must be `true` for a given platform before the upstream dry-run
  hold can release. Arming only the global flag still keeps every platform on
  dry-run. Arming only one platform while the global flag is off still keeps
  that platform on dry-run.
- Producer Console now exposes both arm levels directly. TikTok's arm checkbox
  is intentionally greyed out and frozen until the operator account exists.
- Arming either or both flags does **not** enable real publishing by itself.
  Each connector still fails closed at its own edge until that platform's live
  lane is explicitly opened.
- Use `POST /plugins/artist-runtime/api/platforms/{id}/test` for connector health
  checks (`x`, `instagram`, `tiktok`).
  The route now records `authStatus` and `lastTestedAt` into runtime config for
  X and Instagram. TikTok stays fixed at `authStatus: "unconfigured"` while the
  account remains frozen.
- Keep connector credentials local to the operator machine. CI, packaging, and
  tarball verification should run without bundling these values.

### Operator-only credential notes (`.local/social-credentials.env`)

- An optional reminder file may live at `.local/social-credentials.env`. It is
  ignored by the top-level `.gitignore` and should be created with mode `0600`.
- The file is **not** auto-loaded by the runtime. Connectors read their settings
  from process environment variables only. To apply locally-stored values:

  ```sh
  set -a; . ./.local/social-credentials.env; set +a
  scripts/openclaw-local-gateway start
  ```

- Never paste file contents into logs, PR descriptions, screenshots, or chat
  transcripts.
- A raw password alone does **not** satisfy any connector. Each platform below
  still requires its own session or token.

### Telegram bot opt-in

Telegram is an operator communication bridge, not a social publishing platform.
It is disabled by default and starts only when all of these are true:

1. `telegram.enabled=true` in Artist Runtime config.
2. `TELEGRAM_BOT_TOKEN` is present in the operator environment.
3. `TELEGRAM_OWNER_USER_IDS` contains at least one allowed Telegram user id.

Suggested local setup:

```sh
cat >> .local/social-credentials.env <<'EOF'
TELEGRAM_BOT_TOKEN=<token from BotFather>
TELEGRAM_OWNER_USER_IDS=<numeric owner user id>
EOF
set -a; . ./.local/social-credentials.env; set +a
```

Use BotFather to create the bot token and a user-id helper bot or Telegram
client metadata to find the numeric owner id. Do not commit the local env file
or paste the token body into issue reports, logs, or screenshots.

After the token and owner id are set, enable Telegram itself (gate 1) by setting
`telegram.enabled=true` in the Producer Console **Settings** tab, or in
`runtime/config-overrides.json`:

```json
{ "telegram": { "enabled": true } }
```

Then restart the Gateway process that owns the environment so it picks up the
token and the enabled flag.

## Token expiry reaction

Use this flow when a platform test route reports expired, missing, or failed
auth.

1. Freeze publish attempts for the affected platform and keep the lane in
   dry-run until the platform probe is healthy again.
2. Recreate the credential in the platform's native tool or developer console:
   Bird for X, Meta for Instagram.
3. Reload only the shell or Gateway process that provides the environment.
4. Re-run the matching `POST /plugins/artist-runtime/api/platforms/{id}/test`
   route and confirm the reason cleared.
5. Record only the platform id, timestamp, and redacted reason in operator
   notes. Do not paste token bodies, cookie values, raw Graph responses, or
   CLI credential stores.

For X/Bird, the usual reaction is to refresh Bird's own local authenticated
session and confirm `bird whoami --plain` outside the plugin. For Instagram,
the usual reaction is to issue a fresh Graph API access token with the same
Page / Business Account linkage and restart the OpenClaw process that owns the
environment.

## Social publish ledger rotation

Social publish attempts are written under each song at
`songs/<song-id>/social/social-publish.jsonl`. The writer now rewrites this file
through a temporary file plus `rename(...)`, so an interrupted write should
leave either the previous complete ledger or the next complete ledger, not a
half-written line.

- Entries older than 90 days are moved to
  `songs/<song-id>/social/social-publish.archive.jsonl` the next time the
  writer appends a social publish event for that song.
- The archive is still local workspace state and may contain public URLs,
  dry-run decisions, platform ids, and reason strings. Review it before sharing
  a workspace bundle.
- Operators may delete old archive files manually if they no longer need the
  operational history, but should stop the gateway first to avoid racing an
  active append.
- The status reader uses active ledgers by default and can opt into archive
  reads for historical summaries.

## X (Bird)

### Contract

- Requires the `bird` CLI to be installed and available on `PATH`.
- Auth is expected to live in Bird's own local cookie/token store.
- The plugin probes Bird with `bird --help` and `bird whoami --plain`.
- If the artist account lives in a dedicated Firefox profile, set
  `BIRD_FIREFOX_PROFILE=<profile-dir-basename>` in `.local/social-credentials.env`
  and load `scripts/openclaw-local-env.sh`; the script exports
  `OPENCLAW_X_FIREFOX_PROFILE`, which makes runtime Bird calls add
  `--firefox-profile <name>`.
- `t.co` reply-target expansion is disabled by default. Set
  `OPENCLAW_X_TCO_FETCH_ENABLED=1` only when the operator explicitly wants
  dry-run reply validation to perform a real short-link GET before resolving the
  target status id.
- For a symptom-first X recovery flow, see
  [TROUBLESHOOTING.md#x-probe-red](TROUBLESHOOTING.md#x-probe-red) and the
  Bird reason-code anchors in [ERRORS.md](ERRORS.md).

### Refresh

1. Re-authenticate Bird so its local session store is current. Bird drives the
   account from its configured browser profile (e.g. a dedicated Firefox
   profile); the operator must sign in there directly — runtime cannot script
   that login.
2. Confirm `bird --firefox-profile <name> whoami --plain` returns the expected
   artist `@handle` outside the plugin when a dedicated profile is configured.
   If no dedicated profile is configured, confirm `bird whoami --plain`.
3. Source `scripts/openclaw-local-env.sh` before starting the local gateway so
   `BIRD_FIREFOX_PROFILE` is bridged to `OPENCLAW_X_FIREFOX_PROFILE`.
4. Re-run [`POST /plugins/artist-runtime/api/platforms/x/test`](./API_ROUTES.md#post-apiplatformsxtest).
5. If the route still returns `bird_cli_not_installed`, `bird_auth_expired`, or
   `bird_probe_failed`, inspect the local Bird install/session outside the plugin
   before retrying distribution.

### Probe diagnostics

| Probe reason | Likely cause | Operator recovery |
| --- | --- | --- |
| `connected` | Bird returned the selected `@handle`. | Confirm it is the artist account before arming any later social lane. |
| `bird_cli_not_installed` | `bird` is not on the gateway `PATH`. | Install/repair Bird, then restart the local gateway from an environment that can resolve `bird`. |
| `bird_auth_expired` | Bird reached X but the selected local profile no longer has a valid session. | Re-authenticate the dedicated Firefox profile, then re-run `bird --firefox-profile <name> whoami --plain`. |
| `bird_probe_failed` | Bird ran but did not return a usable account. | Check `OPENCLAW_X_FIREFOX_PROFILE`, run `bird --firefox-profile <name> whoami --plain`, and inspect local Bird output before retrying the route. |

Profile-backed Bird probes can be slower than the default personal profile
because Firefox cookie storage may require a cold SQLite read. Round 76 raised
the runtime probe timeout to match the publish timeout (`3000ms`) after a
dedicated artist profile took slightly over `750ms` to answer `whoami`.

### Dry-run behavior

- Dry-run publish/reply paths stay fail-closed and do not perform real external
  side effects.
- Reply targets accept a bare status id or an `x.com` / `twitter.com`
  `/status/<id>` URL. `t.co` expansion is supported through injected tests or
  `OPENCLAW_X_TCO_FETCH_ENABLED=1`; otherwise the runtime records
  `reply_target_tco_requires_fetch` and stays fail-closed.
- Dry-run X replies write a reply-target audit object into
  `social-publish.jsonl`: `{ type: "reply", targetId, resolvedFrom, dryRun,
  timestamp }`. This is metadata only; it is not proof of a public reply.
- The upstream social pipeline also requires both the global arm and the X
  platform arm to be `true` before it will even attempt to leave dry-run.

## Instagram

> **Operator status (2026-04-25): frozen, parity with TikTok.** The operator
> has decided not to pursue the Instagram lane. The Graph API skeleton, live
> rehearsal gates, and existing tests stay in code as a feature carry-over,
> but no Graph API token will be provisioned, no probe is exercised, and no
> live publish path will be opened. Treat IG identically to TikTok: do not
> add new IG-specific functionality without an explicit operator GO. The
> sections below describe the existing skeleton for reference only.
> For frozen-lane troubleshooting, use
> [TROUBLESHOOTING.md#igtiktok-frozen-attempt](TROUBLESHOOTING.md#igtiktok-frozen-attempt)
> rather than provisioning a token.

### Contract

- The current connector checks one of:
  - `OPENCLAW_INSTAGRAM_AUTH`
  - `OPENCLAW_INSTAGRAM_ACCESS_TOKEN`
- If neither variable is present, the connector reports
  `instagram_auth_not_configured`.
- Round 42 adds a Graph API publish skeleton behind the same env contract. The
  runtime now models these three stages, still fail-closed:
  1. `GET /me/accounts`
  2. `POST /{instagram_business_account_id}/media`
  3. `POST /{instagram_business_account_id}/media_publish`
- Required Meta scopes for the eventual live lane:
  - `pages_show_list`
  - `instagram_basic`
  - `instagram_content_publish`

### Refresh

1. Obtain an Instagram Graph API access token via Meta for Developers
   (requires an Instagram Business/Creator account linked to a Facebook Page
   and a Meta app). A raw login password is **not** accepted.
2. Confirm the Facebook Page is linked to the intended Instagram Business or
   Creator account, because the runtime resolves the Instagram business id from
   the `GET /me/accounts` response.
3. Keep the token in `OPENCLAW_INSTAGRAM_AUTH` or
   `OPENCLAW_INSTAGRAM_ACCESS_TOKEN`.
4. Reload the shell/session that launches OpenClaw so the environment is current.
5. Re-run [`POST /plugins/artist-runtime/api/platforms/instagram/test`](./API_ROUTES.md#post-apiplatformsinstagramtest).

### Dry-run behavior

- Instagram now runs the Graph API skeleton in dry-run only: the runtime is
  wired for the Graph account lookup, media container, and publish-stage fetch
  sequence, but this round still returns `dry-run blocks publish`.
- The live rehearsal skeleton is fail-closed by default. Four gates must all be
  true before the rehearsal code may touch the injected Graph fetch path:
  `distribution.liveGoArmed`, `distribution.platforms.instagram.liveGoArmed`,
  `distribution.platforms.instagram.liveRehearsalArmed`, and an explicit
  runtime `liveRehearsalExplicitGo` signal. The shipped application does not set
  that final signal in normal operation.
- Rehearsal never calls `/{instagram_business_account_id}/media_publish`; it
  stops after account/media-container staging and returns
  `requires_explicit_live_go`.
- Successful Instagram probes record `authStatus: "tested"` and a conservative
  `accessTokenExpiresAt` placeholder when none is already configured. If the
  stored expiry is within 30 days, status exposes
  `instagramTokenExpiringSoon: true` for operator refresh planning.
- The upper social distribution pipeline now adds a second hold: if
  `distribution.enabled` is off, `distribution.liveGoArmed` is off, the
  Instagram platform arm is off, or the target platform toggle is off, the
  publish request is forced back into dry-run before the connector publish path
  is reached.
- Non-dry-run publish attempts are rejected with `requires_explicit_live_go`
  even when auth is configured. Live posting remains outside the current lane.
- Producer Console splits the arm into global + Instagram-specific toggles, so
  operators can pre-arm Instagram without lifting X or TikTok.

### Live rehearsal pre-GO review checklist

Before the operator flips `liveRehearsalExplicitGo` (the final fourth gate),
the following docs and tests must be re-reviewed. The Mega-B round shipped the
fail-closed skeleton; flipping the gate without this review is forbidden.

1. `liveRehearsalExplicitGo` operator hook surface — confirm where the runtime
   reads the explicit signal, and verify no startup default sets it on.
2. Treat the Graph API media container creation as an external side effect —
   even though `media_publish` is never reached, container staging may already
   touch Meta-side state. Re-review `tests/instagram-live-rehearsal.test.ts`
   for non-publish side effects and add coverage as needed.
3. Re-confirm `tests/platform-auth-status.test.ts` keeps Instagram
   `authStatus="tested"` only on a clean probe, with no live publish branch.
4. Re-check the `requires_explicit_live_go` reason path stays the only outward
   refusal reason for the publish stage; the inner reply audit metadata may
   still be richer but must not leak through the connector contract.

This checklist is the operator-side gate referenced in the Mega-B
out-of-scope notes. Update it in the same PR whenever rehearsal scope
changes.

## TikTok

### Contract

TikTok is frozen by operator decision. The skeleton remains documented for
package transparency, but setup and probe exercise are not part of the active
operator lane. See
[TROUBLESHOOTING.md#igtiktok-frozen-attempt](TROUBLESHOOTING.md#igtiktok-frozen-attempt)
and [ERRORS.md#tiktok_account_not_created](ERRORS.md#tiktok_account_not_created).

- TikTok is currently frozen while the operator account is not created.
- `POST /plugins/artist-runtime/api/platforms/tiktok/test` reports
  `account_not_created` regardless of local env state.
- Producer Console shows the TikTok probe badge as frozen and keeps the probe
  button disabled, so the UI never emits a TikTok probe fetch.

### Refresh

1. Treat TikTok as frozen until the operator has actually created the account.
2. Keep [`POST /plugins/artist-runtime/api/platforms/tiktok/test`](./API_ROUTES.md#post-apiplatformstiktoktest)
   as the canonical status route; it should stay on `account_not_created` in
   this lane.
3. Do not arm or probe TikTok from Producer Console while the freeze is active.

### Dry-run behavior

- TikTok remains a dry-run-safe skeleton today. Publish/reply stay fail-closed
  until a real adapter is introduced.
- The upstream social pipeline also requires both the global arm and the TikTok
  platform arm to be `true` before it will even attempt to leave dry-run.
- Producer Console keeps the TikTok arm visible but frozen, reflecting the
  current account-not-created boundary rather than a ready live lane.
