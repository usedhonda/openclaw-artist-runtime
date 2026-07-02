# Runtime Settings Contract

This file is the operator-facing source of truth for Artist Runtime settings.
It describes where each runtime value lives, which layer wins, and which values
are intentionally environment-only.

## Resolution Order

| Layer | Files or source | Precedence | Purpose |
| --- | --- | --- | --- |
| Schema defaults | `src/config/defaultConfig.ts`, `schemas/config.schema.json`, `openclaw.plugin.json` | Lowest | Marketplace-safe defaults and install-time config shape. |
| Saved config | `<workspace>/runtime/config-overrides.json` via `readConfigOverrides()` and `patchResolvedConfig()` | Overrides defaults | Normal operator settings edited from Producer Room Settings. |
| Environment overrides | `applyRuntimeEnvOverrides()` in `src/services/runtimeConfig.ts` | Highest for forced fields | Local operator/deployment switches that must not be silently persisted. |
| Effective response metadata | `GET /config` from `src/routes/responseBuilders.ts` | Read-only description | `fieldMeta` marks env-forced values as read-only and marks dashboard env fallback as editable. |
| Runtime diagnostics | `GET /config.diagnostics` from `src/routes/responseBuilders.ts` | Read-only description | News/X and Telegram readiness inputs are shown as configured/missing/count/boolean only. Secret values are never returned. |

`resolveRuntimeConfig()` merges saved config first and then applies environment
overrides. If a value is marked `source=env` and `editable=false` in
`fieldMeta`, Producer Room must not send it back in `/config/update`.

`dashboard.baseUrl` is the exception: config takes precedence over
`OPENCLAW_DASHBOARD_BASE_URL`, so an env fallback remains editable. This lets an
operator replace a stale local URL with a phone-reachable Tailnet URL from the
Settings screen.

## Schema Config Values

These values are safe to store in `config-overrides.json` and belong in the
manifest schema.

| Path | Owner | Precedence / notes |
| --- | --- | --- |
| `ui.locale` | Schema config | Producer Room language selection. |
| `artist.workspaceRoot` | Schema config, env fallback | Default live workspace is `.local/openclaw/workspace`; `OPENCLAW_LOCAL_WORKSPACE` can select another local workspace. Repo-root persona files are package/reference files unless this is explicitly set to `.`. |
| `artist.identity.displayName`, `artist.identity.producerCallname` | Schema config | Canonical user-editable artist and producer names. `IDENTITY.md` is generated from these values plus `ARTIST.md`/`SOUL.md`; `INNER.md` and `artist/CURRENT_STATE.md` are runtime-managed. See `docs/PERSONA_CANONICAL.md`. |
| `dashboard.baseUrl` | Schema config, env fallback | Config value wins over `OPENCLAW_DASHBOARD_BASE_URL`; used for Telegram Dashboard links. |
| `autopilot.enabled`, `autopilot.dryRun`, `autopilot.songsPerWeek`, `autopilot.cycleIntervalMinutes`, `autopilot.planningTimeoutDays`, `autopilot.producerDigest` | Schema config | `OPENCLAW_AUTOPILOT_DRYRUN_OVERRIDE=off` can force `dryRun=false` and makes the field read-only in Settings. Legacy `autopilot.intervalMinutes` is read as `cycleIntervalMinutes` and not written back. |
| `music.suno.driver`, `music.suno.submitMode`, `music.suno.connectionMode` | Schema config, env forced | `OPENCLAW_SUNO_LIVE`, `OPENCLAW_SUNO_DRIVER`, and `OPENCLAW_SUNO_SUBMIT_MODE` can force these values and make them read-only in Settings. |
| `music.suno.dailyCreditLimit`, `music.suno.monthlyCreditLimit` | Schema config | Credit reservation gates used before live Suno Create. `dailyCreditLimit` is the daily credit source of truth. |
| `music.suno.monthlyGenerationBudget`, `music.suno.maxGenerationsPerDay`, `music.suno.minMinutesBetweenCreates` | Schema config | Generation-count and cooldown gates. `maxGenerationsPerDay` is the daily create-run cap. |
| `distribution.*` and `distribution.platforms.*` | Schema config | Social enablement, authority, and live arms. Frozen platform behavior still fails closed in runtime code. |
| `telegram.enabled`, `telegram.pollIntervalMs`, `telegram.notifyStages`, `telegram.acceptFreeText` | Schema config | Telegram feature preferences. Transport credentials and owner IDs remain env-only. |
| `artistPulse.enabled`, `artistPulse.minIntervalHours` | Schema config, env opt-in | Settings value can enable routine artist notes; env can also opt in for local operator runs. |
| `commission.enabled` | Schema config, env opt-in | Settings value can enable producer song requests; env can also opt in for local operator runs. |
| `songSpawn.enabled`, `songSpawn.minIntervalHours` | Schema config, env opt-in | Settings value controls autonomous song ideas; env can also opt in and override interval for local operator runs. |
| `aiReview.provider` | Schema config, env forced | Supported values are `mock`, `openclaw`, and `openai-codex`. `OPENCLAW_AI_REVIEW_PROVIDER` can force the effective provider and makes the field read-only in Settings. |
| `safety.*` | Schema config | Safety policy defaults and invariant guard settings. |

## Environment-Only Values

These values are intentionally not part of the editable schema. They are either
credentials, local machine paths, infrastructure addresses, or low-level
diagnostic switches.

| Env var | Display surface | Reason |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Settings diagnostics: configured/missing only | Credential. Never return or persist the token value. |
| `TELEGRAM_OWNER_USER_IDS` | Settings diagnostics: count only | Private account identifiers. Runtime uses them for owner checks and notifier chat targets. |
| `OPENCLAW_TELEGRAM_NOTIFIER` | Settings diagnostics: enabled/disabled | Local transport switch. It can disable Telegram even when schema settings are on. |
| `OPENCLAW_NEWS_RSS_URLS` | Settings diagnostics: count only | News source list can contain private/local feeds. Runtime only shows how many are configured. |
| `OPENCLAW_NEWS_BROWSER_RESOLVE`, `OPENCLAW_NEWS_ARTICLE_RESOLVE` | Settings diagnostics: enabled/disabled | Local network/browser behavior; kept env-only to avoid marketplace operators enabling browser fetch accidentally. |
| `OPENCLAW_X_FIREFOX_PROFILE` | Settings diagnostics: configured/missing only | Local Firefox profile path for Bird/X. Paths are private machine details. |
| `OPENCLAW_X_TCO_FETCH_ENABLED` | Settings diagnostics: enabled/disabled | Local X link-resolution switch. |
| `OPENCLAW_CONFIG`, `OPENCLAW_AUTH_PROFILES` | Not shown | Local OpenClaw auth/config file locations. Paths may reveal user account layout. |
| `SPOTIFY_BEARER_TOKEN` | Not shown | Credential for optional music lookup helpers. |
| `OPENCLAW_SUNO_CDP_ENDPOINT`, `OPENCLAW_SUNO_USE_CDP` | Not shown | Low-level browser attach controls; CDP is an emergency/operator-only path. |
| `OPENCLAW_SUNO_LYRICS_LIMIT` | Not shown | Low-level DOM/lyrics box guard used by Suno registration. |
| `OPENCLAW_BIRD_DAILY_MAX`, `OPENCLAW_BIRD_MIN_INTERVAL_MINUTES` | `/config/overrides` read/write helper only | Operator runtime safety override for Bird rate limiting; not part of the general Settings form. |
| `OPENCLAW_PRE_GENERATION_APPROVAL`, debug/replay/watchdog env vars | Not shown in Settings | Operational/debug toggles. They should stay in runbooks and diagnostics, not become casual Settings controls. |

## Observation Diagnostics

For how the observation queries are built, staged, broadened, cached, and parsed, see [Observation Pipeline](OBSERVATION_PIPELINE.md).

X search diagnostics are read-only runtime facts, not editable settings. The
latest collection writes `<workspace>/runtime/x-observation-diagnostics.json`
and `/api/status` exposes the same safe summary as `observationDiagnostics`.

Producer Room shows an `X search diagnostics` card with the attempted queries,
raw result counts, accepted counts, and the top rejection reason. Telegram
`/observations [YYYY-MM-DD]` appends the same search trail under `🔎 探し方`;
this section is especially important when accepted observations are zero.

The snapshot also carries an `outcome` field (`collected` | `cooldown` | `error`)
and a sanitized `reason`, so cooldown and error runs leave a diagnostics trail too
(not only successful collections). On a cooldown or error the file is still written
with the attempts made so far.

Ban detection scope: bird ban/rate-limit detection runs on the runner's stderr
always, and on stdout only when stdout produced zero parsed entries and looks like a
short non-JSON error blurb. stdout that parsed at least one raw entry is treated as
real tweet payload and never scanned, so ordinary tweets containing words like
速度制限 or 路面凍結 cannot trigger a 24h cooldown. When a genuine ban indicator
fires, `cooldownReason` stores only a sanitized marker
(`ban_indication: <token> (source: stderr|stdout|error)`), never raw tweet text.

Privacy rule: rejected tweet body text and rejected URLs are never displayed in
Telegram, Producer Room, or status JSON. Only counts, rejection reason enums,
and boolean/url-kind diagnostics are exposed.

## X Search Verification Runbook

Use this to confirm that live X (Bird) observation search is actually pulling
reactions, without burning the daily call budget. For the underlying query and
collection mechanism, see [Observation Pipeline](OBSERVATION_PIPELINE.md).

### Procedure

1. Check budget and cooldown first. Read the Bird ledger
   (`runtime/bird-call-ledger.json`, or the Bird rate-limit detail in `/api/status`):
   confirm `todayCalls` is below `dailyMax` and there is no active `cooldownUntil`.
   If a `bird_cooldown_triggered` event fired recently, wait it out rather than
   forcing a run.
2. Trigger one collection. Prefer the natural autopilot cycle; use `/api/run-cycle`
   only when you need it immediately. Do not run twice in a row -- a second call
   spends budget and may read the empty-result cache instead of searching.
3. Read `runtime/x-observation-diagnostics.json`. For each attempt, record the query
   order and stage (phrase -> shortened phrase -> `lang:ja since` -> motif -> broad
   fallback), each stage's `rawCount` -> `acceptedCount`, and
   `rejectedCountsByReason`. Confirm whether accepted reactions landed in
   `observations/*.md` and flowed into the next spawn brief as an `x` observation
   source.
4. Judge the outcome:
   - PASS: at least one query stage has `acceptedCount >= 1` and the observation file
     records an X entry.
   - PARTIAL: raw results arrive but every entry is rejected. Read
     `rejectedCountsByReason` to pick the next improvement (filter tuning, URL/author
     requirements, motif scope).
   - FAIL: every stage returns `rawCount 0`. Split the cause between query generation
     (too narrow, or none produced) and the Bird environment (auth, profile, network).

### Measurement log

- 2026-07-02 04:38Z, news seed "NY supertall building summit". Two ordered query
  variants were tried (full phrase, then shortened phrase); both returned
  `rawCount 0`. FAIL by the rule above, but a genuine "no reaction exists" case:
  query generation and the Bird environment were healthy, the topic simply had no
  matching X reaction at that moment. Recorded as the first live measurement example.
- Context: on 2026-06-30 a ban false-positive stopped X collection for 24h -- an
  ordinary tweet containing 制限 tripped the ban detector and set a 24h cooldown.
  That is fixed in commit `91a0f90`: ban detection now scopes to stderr / error
  output only and never scans parsed tweet payload (see Observation Diagnostics
  above).

### Notes

- Bird `dailyMax` is 5 calls/day. A single collection can spend several calls because
  it walks the ordered query variants until one returns entries.
- Empty results are cached for 20 minutes; re-triggering inside that window reads the
  empty cache instead of searching, so wait out the TTL before re-measuring.
- The same diagnostics are readable from the Telegram `/observations [YYYY-MM-DD]`
  command and the Producer Room diagnostics view (the `X search diagnostics` card),
  not only the raw JSON file.

## Retired Legacy Values

| Legacy value | Current behavior |
| --- | --- |
| `suno.dailyBudget` in `config-overrides.json` | Retired. It is ignored by resolved config and no longer gates generation. It is auto-pruned from `config-overrides.json` on the next overrides write (any config or safety-override update). |
| `OPENCLAW_SUNO_DAILY_BUDGET` | Retired. Suno daily credit budget is `music.suno.dailyCreditLimit`; daily create-run cap is `music.suno.maxGenerationsPerDay`. |
| `autopilot.intervalMinutes` | Compatibility read. It is normalized to `autopilot.cycleIntervalMinutes` and removed from resolved config. |

## Manifest And Fallback Surfaces

- `openclaw.plugin.json` and `schemas/config.schema.json` must stay aligned.
- `openclaw.plugin.json.uiHints` should describe every operator-facing runtime
  value that appears in Settings.
- `src/routes/uiFallback.ts` is a degraded HTML fallback. It must not expose
  removed settings such as `suno.dailyBudget`, and its config form must follow
  the current credit/cap model:
  `dailyCreditLimit`, `monthlyCreditLimit`, `monthlyGenerationBudget`,
  `maxGenerationsPerDay`, and `minMinutesBetweenCreates`.
- React Producer Room is the primary UI. Fallback HTML is only for stale/missing
  bundle recovery and should remain conservative.
