# Suno Browser Driver

This document tracks the operator-facing setup for the dedicated Suno browser
lane.

See also: [OPERATOR_QUICKSTART.md](OPERATOR_QUICKSTART.md),
[TROUBLESHOOTING.md](TROUBLESHOOTING.md), [ERRORS.md](ERRORS.md),
[OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md), and
[RUNTIME_CLEANUP.md](RUNTIME_CLEANUP.md).

## Status

Round 41 keeps the real Playwright probe plus manual first-login helper, allows
`submitMode: "live"` to click `Create`, polls the Suno library for new song
URLs, and can now import finished runs by downloading mp3 assets into the local
workspace. `submitMode: "skip"` still fills the form without submission for
credit-safe rehearsals.

## `suno_cli` driver (CREATE path over authenticated HTTP)

Set `music.suno.driver: "suno_cli"` to drive song creation through the external
`suno-cli` tool instead of the browser DOM worker. The
CLI does a real authenticated HTTP POST to Suno's generate endpoint, which
removes the fragile DOM form-filling from the CREATE path. For import, this
driver runs the CLI's own `download` subcommand to fetch each finished run's
audio (`create` already returns each clip's song URL); it does not defer to the
browser worker's recovery path.

Required environment (all read per-create; nothing is hardcoded so the plugin
stays distribution-safe):

- `OPENCLAW_SUNO_CLI_ENTRY` — absolute path to the built `dist/src/cli.js`
  entry. Build `suno-cli` separately (`npm run build`); its `dist/` is
  gitignored. Unset -> fail-closed `suno_cli_not_configured` (no fake URLs).
- `SUNO_KIT_COOKIE` (or `SUNO_KIT_COOKIE_FILE`) — the Clerk session cookie the
  CLI derives a short-lived Bearer JWT from. Inherited into the child process
  and never read or logged here.
- `OPENCLAW_SUNO_CAPTCHA_TOKEN` (optional) — a fresh, single-use, short-TTL
  hCaptcha token, forwarded only when paired with a valid token-provider.
- `OPENCLAW_SUNO_TOKEN_PROVIDER` (optional) — the paired token-provider, which
  must parse to a safe integer.

The captcha pair is browser-minted and supplied right before each create;
automating that mint is a later phase. The pair is optional: when both the token
and a safe-integer token-provider are present they are forwarded to the CLI,
otherwise both flags are omitted and the create runs without them. There is no
`suno_cli_captcha_missing` fail-closed reason; a captcha the CLI itself rejects
surfaces as exit 31 -> `suno_cli_blocked_captcha` (see the table below).

The connector passes `--min-minutes-between-creates 0` and a high
`--max-generations-per-day` so artist-runtime's own `SunoBudgetTracker` stays
authoritative and the CLI's gate does not double-reject.

Outcomes are judged by the CLI's exit code (never by string-matching stdout):

| exit | reason |
| --- | --- |
| 0 | accepted, every `clips[].songUrl` returned |
| 2 | `suno_cli_usage` |
| 30 | `suno_cli_blocked_login` |
| 31 | `suno_cli_blocked_captcha` |
| 32 | `suno_cli_blocked_quota` |
| 40 | `suno_cli_schema_drift` (also unexpected/non-JSON stdout on exit 0) |
| 50 | `suno_cli_retryable` |
| 70 (and any other non-zero) | `suno_cli_internal` |

Credential safety: the captcha token is redacted (`***`) in any diagnostic log
and never appears in a returned reason; the cookie/JWT are never logged.

### Dormant CDP plumbing for explicit captcha diagnostics (`OPENCLAW_SUNO_USE_CDP`)

Normal `suno-cli create --live` never invokes browser captcha minting. Since
suno-kit `1dde8ea`, it submits null captcha fields when no explicit token pair is
provided and fails closed as `blocked_captcha` (exit 31) if Suno requires one;
there is no automatic browser fallback. Artist Runtime currently invokes only
this normal live path.

Suno-cli still provides `create --mint-check` as an explicit no-submit browser
diagnostic, but Artist Runtime does not invoke that command. The connector keeps
the following CDP environment wiring as dormant plumbing for a future explicit
diagnostic surface:

- `OPENCLAW_SUNO_USE_CDP` — `on`/`1`/`true` enables CDP attach; anything else
  (including unset) leaves it off.
- `OPENCLAW_SUNO_CDP_ENDPOINT` — the loopback CDP endpoint to attach to.
  Defaults to `http://127.0.0.1:9222` when enabled without an explicit value.

When the flag is off or unset, `SUNO_KIT_CDP_ENDPOINT` is explicitly stripped
from the child env even if the parent process happens to have it set. When it is
on, the variable is passed but remains unused by Artist Runtime's normal live
create because that path does not construct a browser minter. This mirrors
`isSunoCdpEnabled()`/`sunoCdpEndpoint()` in `runtimeConfig.ts`, the same helpers
the retired-for-now playwright driver's CDP path uses (`sunoPlaywrightDriver.ts`).

Trap: suno-cli prints `Live create submit is disabled in this build` only when
neither `--dry-run` nor `--live` is passed. It is **not** a global kill-switch.
This driver always passes `--live` and judges by exit code; never parse that
string to conclude live is unavailable.

## Prerequisites

- Use an existing Suno account that the operator controls.
- Keep the browser session on the operator machine only.
- Expect manual login first; automated probing/generation lands in later rounds.
- The browser lane now uses `playwright-extra` plus
  `puppeteer-extra-plugin-stealth` and defaults to bundled Chromium with an
  isolated profile. `channel: "chrome"` is opt-in only because the macOS Chrome
  singleton can otherwise navigate the operator's visible Chrome window.

## Profile path

- Dedicated local profile path: `.openclaw-browser-profiles/suno/`
- This path is excluded from git and must stay on the operator machine.
- Do not copy the profile into ledgers, package artifacts, screenshots, or logs.

## Profile lifecycle

Round 67 adds local lifecycle checks around the dedicated browser profile
without changing the submit path:

- the runtime treats a missing profile or a profile with no recent filesystem
  activity for 30 days as `sunoProfileStale: true` on the Suno worker status
  surface;
- stale detection is fail-open: it warns the operator but does not click
  Create, block dry-run probes, or mutate `submitMode`;
- `scripts/suno-profile-diagnose.sh` prints local-only diagnostics for the
  profile path, cookie-like file count, latest touched file, and storage usage;
- `scripts/suno-profile-backup.sh` writes a daily tar snapshot under
  `.openclaw-browser-profiles/suno.backup/<YYYY-MM-DD>/suno-profile.tar.gz`
  and keeps seven generations by default;
- the TypeScript lifecycle helper can also create directory snapshots and prune
  old generations for tests and future runtime wiring.
- operator-run cleanup treats `runtime/suno/profile-snapshots/` as a local-only
  snapshot store and prunes entries older than 365 days when
  `scripts/cleanup-runtime.sh` is run manually.

When `sunoProfileStale` appears, first run the diagnose script, then either
rerun `scripts/openclaw-suno-login.sh` for normal reauthentication or follow
Scenario A below if the profile is corrupt. Keep all snapshots local to the
operator machine.

## Dependency install (operator)

Playwright is now a package dependency, but browser binaries are still an
operator-side install step. Run these on the operator machine:

```bash
npm install playwright
npx playwright install chromium
```

The project keeps `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` for CI/package installs,
so Chromium is not fetched automatically.

## First login

Use the manual wrapper once per operator machine or whenever the Suno session
expires:

```bash
scripts/openclaw-suno-login.sh
```

That script opens Chromium with the dedicated persistent profile, navigates to
the Suno create surface, and waits for the operator to finish login manually.
Close the browser window when login is complete.

## Google OAuth bot detection workaround

The current login lane uses the stealth plugin and Chrome channel launch options
to suppress the default Playwright automation markers that Google OAuth was
rejecting. In practice, if the operator can sign into Suno through ordinary
Chrome on the same machine, the Playwright lane should now follow the same
Google OAuth flow instead of failing at the "could not sign you in" screen.

If login still fails:

1. confirm ordinary Chrome can sign into the same Suno account;
2. rerun `scripts/openclaw-suno-login.sh`;
3. after login, verify the profile with `music.suno.driver = "playwright"` and
   the existing Suno status/probe surface.

## Config toggle

Enable the browser lane through runtime config override:

```json
{
  "music": {
    "suno": {
      "driver": "playwright"
    }
  }
}
```

Default remains:

```json
{
  "music": {
    "suno": {
      "driver": "mock"
    }
  }
}
```

To control create behavior separately:

```json
{
  "music": {
    "suno": {
      "submitMode": "skip"
    }
  }
}
```

`submitMode: "skip"` is the default and fills the Suno form without clicking
`Create`. `submitMode: "live"` is now the operator-approved path that clicks
`Create` and waits for new Suno song URLs to appear first on `/create`, then in
the library if the card view stays silent.

## Dry-run vs live

`autopilot.dryRun` and `music.suno.driver` are separate controls:

- `driver: "mock"` + `dryRun: true` keeps the current fully stubbed lane
- `driver: "playwright"` + `dryRun: true` is the current probe-only / no-credit
  lane
- `driver: "playwright"` + `submitMode: "skip"` fills lyrics/style/instrumental
  fields on `/create` but still never clicks the `Create` button
- `driver: "playwright"` + `submitMode: "live"` clicks `Create` and polls
  `https://suno.com/me` until new song URLs appear or the timeout is hit

## Round 40 live submit

The live create lane now performs the following:

1. snapshots the current song URLs from `https://suno.com/me`;
2. opens `https://suno.com/create` in the dedicated persistent profile;
3. fills lyrics, style, exclude styles, and the instrumental toggle when the
   payload includes them;
4. clicks `button[aria-label="Create song"]` only when
   `music.suno.submitMode = "live"`;
5. polls `/create` generation cards every 3 seconds for up to 3 minutes and
   prefers those song URLs first;
6. if `/create` stays quiet, falls back to `https://suno.com/me` library diff
   polling for the remaining 7 minutes;
7. returns the new `/song/<uuid>` URLs once either lane observes them.

If no new song URLs appear before timeout, the driver returns
`playwright_live_timeout`.

## Take-URL delivery contract (both URLs together)

Suno always produces exactly two takes per generation, and both `/song/<uuid>`
take-page URLs are available together. The `suno_take_url_ready` Telegram
notification must therefore carry BOTH take URLs, gathered together — it must not
fire with a single URL while the second is (or will imminently be) available.

- The expected take count is a single source of truth,
  `PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT` (= 2), re-exported as
  `EXPECTED_SUNO_TAKE_URLS`. The DOM create driver already only returns
  `accepted: true` once it has captured at least that many take URLs.
- Every `suno_take_url_ready` emission is gated on collecting that many distinct,
  valid `https://suno.com/song/<id>` URLs (deduped by take id). While a run has
  only one captured take URL, the song is held in `suno_running`
  (`blockedReason: awaiting_second_suno_take_url`) and the autopilot cycle
  re-checks it instead of notifying with one URL.
- Bounded single-URL fallback (fail-open): if only one take URL ever materializes,
  the run is delivered with that single URL once it has waited past
  `OPENCLAW_SUNO_SINGLE_TAKE_FALLBACK_MINUTES` (default 5 minutes). The event then
  carries `reason: single_take_url_fallback` so the degraded delivery is
  auditable. Delivering one valid URL is preferred over never delivering.
- The bounded fallback is evaluated only after the audio import-first attempt has
  run and yielded a benign not-ready outcome, so the dry-run isolation and
  take-attribution collision guards still fire first.

## Round 41 import and audio download

After a successful Round 40 live create, the driver can now revisit the returned
`/song/<uuid>` URLs, extract the audio asset URL from the page payload, and save
the downloaded files under:

```txt
runtime/suno/<runId>/<trackId>.<mp3|m4a>
```

Import stays fail-closed:

- `urls=[]` returns `playwright_import_no_urls`
- direct `audio[src*=".mp3"]` is preferred, then `audio[src*=".m4a"]`, then the
  page payload script as fallback
- per-song failures are accumulated into `reason`
- at least one saved audio file is required for `accepted: true`
- partial success keeps the successful paths and reports the failed URLs in
  `reason`
- lightweight metadata (`title`, `durationSec`, `format`) is returned alongside
  saved paths and mirrored into `/api/status`

Round 49 now locks the cheap boundary cases in mock-only tests:

- extracted `.mp3` assets stay `.mp3` on disk and in metadata
- extracted `.m4a` fallback assets stay `.m4a` on disk and in metadata
- 404 downloads fail closed with empty imported paths and a recorded reason

## Imported assets in Producer Console

- Producer Console now mirrors the latest imported Suno asset evidence from
  `lastImportOutcome.paths` and `lastImportOutcome.metadata`.
- Imported assets are shown as read-only links plus static metadata (`title`,
  `durationSec`, `format`, `path`). There is no inline player, playback widget,
  or metadata editor in this lane.
- Each imported asset row also provides a copy-path button so the operator can
  hand the absolute path off to Finder, a local player, or another local tool
  without exposing the runtime directory over HTTP.
- If no imported files have been recorded yet, the Console keeps the explicit
  placeholder `No imported assets yet.`
- Round 78 also indexes the local `runtime/suno/<runId>/` directory and exposes
  the latest mp3/m4a artifacts in the Console. The index is read-only and shows
  `runId`, optional `songId`, file size, format, created timestamp, and path.
- `/api/status.suno.artifacts` stays capped to the latest 8 entries for the
  dashboard. Operators can page the full local artifact index through
  `/api/suno/artifacts?offset=N&limit=M`; the route defaults to
  `offset=0&limit=20` and clamps `limit` to `100`.
- The Imported Assets section includes a session-local URL prefix filter. It
  filters the already-returned rows only; it does not fetch, play, or mutate
  artifacts.
- Failed import URLs are surfaced separately as `failedUrls[]` with a compact
  reason (`404`, `network`, or `extraction_failed`) so partial imports can be
  triaged without re-running the whole Suno job.

## Diagnostics export

`GET /api/suno/diagnostics/export?days=N` returns a synchronous JSON dump for
operator support bundles. It defaults to 7 days and clamps `days` to 30.

The export includes only local operational state:

- Suno worker/profile state (`state`, `connected`, stale flag, stale detail,
  checked timestamp)
- recent budget reset audit rows from `runtime/suno/budget-reset.jsonl`
- recent per-song import outcomes, including failed URL summaries and local
  artifact paths

It intentionally excludes browser profile contents, cookies, tokens, headers,
raw credential files, and Suno page bodies. Treat the JSON as operator-local
evidence; review paths and song titles before attaching it to tickets.

## Credit budget

`submitMode: "skip"` still consumes zero credits. `submitMode: "live"` now
consumes real Suno credits and should only be enabled after explicit operator
approval. Round 41 audio import/download does not create new generations on its
own; it only pulls finished outputs from the returned song URLs.

Round 51 adds a hard UTC-day credit gate in front of the live Create click:

- `music.suno.dailyCreditLimit` defaults to `60`
- each live submit reserves `10` credits before the Create click is allowed
- the counter persists in `runtime/suno/budget.json`
- the counter resets when `new Date().toISOString().slice(0, 10)` crosses into
  the next UTC day
- if the reservation would exceed the limit, the run fails closed with
  `budget_exhausted` and the Playwright submit path is never entered
- `music.suno.monthlyCreditLimit` defaults to `0`, which means the UTC-month
  gate is unlimited until the operator opts in
- when `monthlyCreditLimit > 0`, the same pre-click reservation also checks the
  UTC-month counter and fails closed with `budget_exhausted_monthly` before
  Playwright can submit

Round 52 exposes that same counter back to the operator without mutating it:

- `/api/status` now returns `suno.budget = { date, consumed, limit, remaining,
  lastResetAt, monthly }`
- Producer Console renders a read-only budget card with the UTC date and a
  progress bar
- Producer Console also renders a monthly progress skeleton. If
  `monthlyCreditLimit` is `0`, the monthly lane is labeled unlimited.
- Producer Console also provides a confirmed `Reset budget` action that writes
  today's UTC date with `consumed: 0`, so the operator can reopen the daily
  lane without waiting for the automatic UTC rollover
- Producer Console Config Editor can now update `music.suno.dailyCreditLimit`
  directly, so operators usually do not need to touch `budget.json` just to
  raise or lower the daily ceiling
- Producer Console Config Editor can also update `music.suno.monthlyCreditLimit`
  as an opt-in monthly hard stop
- the bar turns warning at `80%` consumed and error at `100%`
- read-only views call `getState()` only, so they never reset or reserve budget
  by side effect

### Editing budget.json

The live credit counter is stored at `runtime/suno/budget.json` relative to the
active workspace root.

Current on-disk shape:

```json
{
  "date": "YYYY-MM-DD",
  "consumed": 10,
  "month": "YYYY-MM",
  "monthlyConsumed": 10,
  "lastResetAt": "YYYY-MM-DDTHH:mm:ss.sssZ"
}
```

Tracker behavior is intentionally simple and defensive:

- if the file is missing, the tracker falls back to an empty state for today
  with `consumed: 0`
- if `date` is missing or not a string, the tracker falls back to the current
  UTC date
- if `consumed` is missing or not `Number.isFinite(...)`, the tracker falls
  back to `0`
- if the stored `date` does not match the current UTC date, `getState()` and
  `reserve()` both normalize the view back to `consumed: 0` on today's date
- if the stored `month` does not match the current UTC month, `getState()` and
  `reserve()` normalize the monthly view back to `monthlyConsumed: 0`
- if the file contains invalid JSON, the tracker falls back to an empty state
  for today with `consumed: 0`; the next successful write restores valid JSON
- writes go through a `.tmp` file and `rename(...)`, so a partial write should
  not replace the last valid `budget.json` with a half-written file
- after a successful write, stale `budget.json.tmp` leftovers are removed
- manual resets append a local audit line to `runtime/suno/budget-reset.jsonl`
  with `{ timestamp, consumedBefore, reason }`
- `/api/status.suno.budget.resetHistory` reads the most recent reset audit
  lines, skips malformed jsonl rows, and the Producer Console shows the latest
  reset timestamp / previous consumed value / reason next to the budget card.

Recommended operator edit flow:

1. stop the local Gateway/runtime first when practical, to avoid editing during
   an active write
2. create a backup copy such as
   `cp runtime/suno/budget.json runtime/suno/budget.json.bak`
3. edit the JSON carefully
4. validate the file shape before resuming, for example with
   `jq . runtime/suno/budget.json`
5. restart the Gateway/runtime and let the next `getState()` / `reserve()` read
   the updated values

Common manual edits:

- early daily reset: set `consumed` back to `0`
- testing or operator verification: adjust `consumed` to a known finite number
- monthly opt-in verification: adjust `monthlyConsumed` to a known finite number
- changing `date`: generally not recommended, because the tracker already
  normalizes stale dates automatically

Avoid these edits:

- saving invalid JSON
- writing `consumed` as a negative value, string, `NaN`, or any other non-finite
  value
- editing the file while another process may be writing to it

## Operator recovery

Use these flows when the dedicated Suno browser profile needs operator recovery.
Every action here is operator-run on the local machine. Keep the same security
boundary as `SECURITY.md` / `PRIVACY.md`: do not paste profile contents,
cookies, session tokens, screenshots, or chat transcripts into PRs, logs, or
shared threads.

When `/api/status.suno.profile.stale` is true, the Producer Console shows a
manual-recovery banner. It points operators at `scripts/suno-profile-diagnose.sh`
but never runs that script from the browser; diagnostics remain local CLI work.

### Scenario A: profile corruption

Use this when the browser lane starts failing at launch, the profile directory
is unreadable, or repeated login probes keep failing after ordinary retry.

1. Stop the local Gateway/runtime before touching the profile directory.
2. Rename `.openclaw-browser-profiles/suno/` to a backup path such as
   `.openclaw-browser-profiles/suno.bak-YYYYMMDD-HHMMSS` instead of deleting it.
3. Create a fresh empty `.openclaw-browser-profiles/suno/` directory.
4. Rerun `scripts/openclaw-suno-login.sh` so the driver launches the fresh
   persistent profile with the existing stealth-plugin + bundled Chromium lane.
5. Complete Google OAuth manually as the operator, then close the browser.
6. Re-run the login probe and confirm it returns `connected: true` before
   resuming normal use.

Backup and rebuild notes:

- Keep the backup local to the operator machine. Do not attach it to an
  incident, issue, PR, or package artifact.
- Prefer the daily snapshot lane from `scripts/suno-profile-backup.sh` before
  destructive recovery, then keep only the latest seven generations unless the
  operator has a local retention reason.
- Prefer rename-over-delete for the first recovery pass so the operator can
  inspect filesystem permissions or copy mistakes later.
- Do not cherry-pick individual Chromium cookie, storage, or cache files. The
  browser profile layout is version-dependent.
- Treat a rebuilt profile as untrusted until `POST /api/platforms` surfaces and
  the Suno probe both show the expected operator-owned account state.

### Scenario B: Google OAuth reauthentication required

Use this when the probe starts returning `login_required`, the Suno session
expires, or another machine/logout invalidates the current cookie state.

1. Treat `login_required` as a manual-operator handoff, not an automation bug.
2. Re-run `scripts/openclaw-suno-login.sh`.
3. Complete the Google OAuth flow manually in the Chrome-channel browser window.
   The runtime must not auto-script this step.
4. Close the browser once the operator reaches the authenticated Suno surface.
5. Re-run the probe and confirm it returns `connected: true`.

### Scenario C: profile migration

Use this when the operator moves the Suno lane to a different Mac or a different
local user account.

1. Stop the runtime on both source and destination machines before copying the
   profile directory.
2. Copy `.openclaw-browser-profiles/suno/` as a whole directory; do not cherry-
   pick internal Chromium files because the exact layout can vary by version.
3. After copy, verify filesystem ownership/permissions so the destination user
   can read and write the profile.
4. Expect Chrome / Chromium version differences and OS path differences to
   invalidate the moved session; if that happens, fall back to Scenario B and
   reauthenticate manually.
5. Re-run the probe on the destination machine and require `connected: true`
   before trusting the migrated profile.

### Scenario D: credit budget exhausted

Use this when a live create attempt returns `accepted: false` with
`reason: "budget_exhausted"` or `reason: "budget_exhausted_monthly"`.

1. Inspect the current budget state through Producer Console or `/api/status`
   rather than editing the persistence file directly.
2. If the daily cap is too low for the operator's current lane, adjust
   `music.suno.dailyCreditLimit` through the normal config workflow.
3. If the monthly cap is too low for the operator's current lane, adjust
   `music.suno.monthlyCreditLimit`; keep it at `0` to disable the monthly hard
   stop.
4. If no config change is desired, wait for the next UTC day boundary; the
   runtime resets the visible counter automatically when the date changes.
5. After the UTC boundary or config change, re-check the status surface and
   confirm `remaining` has reopened before attempting another live create.
6. If the operator needs to reopen the current day immediately, use the
   Producer Console `Reset budget` action and confirm the prompt.
7. If the operator must override the current day manually, use the
   `Editing budget.json` guidance above and keep the file valid JSON.

## Artifact retention

- Imported artifacts under `runtime/suno/<runId>/` are kept indefinitely by
  default. The runtime does not auto-delete completed mp3/m4a imports or their
  lightweight metadata.
- The operator should treat artifact cleanup as a manual maintenance task and
  review older `runId` directories on a monthly or half-year cadence.
- Before sharing, exporting, or uploading retained artifacts, the operator
  should manually review the audio, lyrics alignment, and lightweight metadata.
- Artifact deletion and budget state are separate layers. Removing
  `runtime/suno/<runId>/` does not reset or lower the UTC-day credit counter.
- If the operator intentionally needs to alter the current budget counter, that
  is a separate manual decision against `runtime/suno/budget.json`; deleting an
  imported run directory alone does not change the Round 51/52 budget state.
- Operators can run `scripts/cleanup-runtime.sh` to list and remove
  `runtime/suno/<runId>/` directories older than 30 days. Without `-y`, the
  script asks for confirmation before deleting anything.
- The same manual cleanup command also lists and removes
  `runtime/suno/profile-snapshots/` entries older than 365 days. Fresh snapshots
  and the snapshot root itself are left intact.

## Debug AI review

The Telegram `/review <songId>` command is debug-only. It reads the song brief,
latest lyrics, Suno take metadata, selected take, and prompt-pack summary, then
writes a review record under `runtime/debug-ai-reviews/`. The default provider
is `mock`, so no external model is called and no take selection is changed.

Review output is intentionally outside the Suno/autopilot control path. It does
not alter `selected-take.json`, does not trigger Suno create/import, and does
not participate in the publish gate. Treat the saved JSON as local operator
debug evidence.

## Troubleshooting

- Login probe says `login_required`: follow Scenario B.
- Browser/profile fails to launch or repeated login probes collapse: follow
  Scenario A.
- Moving the Suno lane to another operator machine or account: follow
  Scenario C.
- Live create fails with `budget_exhausted`: follow Scenario D.
- For the symptom-first decision tree, see
  [TROUBLESHOOTING.md#suno-profile-stale-or-corrupt](TROUBLESHOOTING.md#suno-profile-stale-or-corrupt)
  and [TROUBLESHOOTING.md#suno-budget-exhausted](TROUBLESHOOTING.md#suno-budget-exhausted).

## Rollback

Set `music.suno.driver` back to `mock` to return immediately to the built-in
dry-run-safe skeleton.

## See also

- `docs/CONNECTOR_AUTH.md`
- `docs/GATEWAY_AUTH.md`
- `docs/OPERATOR_QUICKSTART.md`
- `docs/TROUBLESHOOTING.md`
- `docs/ERRORS.md`
- `SECURITY.md`
- `PRIVACY.md`
