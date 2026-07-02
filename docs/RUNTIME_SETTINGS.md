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

X search diagnostics are read-only runtime facts, not editable settings. The
latest collection writes `<workspace>/runtime/x-observation-diagnostics.json`
and `/api/status` exposes the same safe summary as `observationDiagnostics`.

Producer Room shows an `X search diagnostics` card with the attempted queries,
raw result counts, accepted counts, and the top rejection reason. Telegram
`/observations [YYYY-MM-DD]` appends the same search trail under `🔎 探し方`;
this section is especially important when accepted observations are zero.

Privacy rule: rejected tweet body text and rejected URLs are never displayed in
Telegram, Producer Room, or status JSON. Only counts, rejection reason enums,
and boolean/url-kind diagnostics are exposed.

## Retired Legacy Values

| Legacy value | Current behavior |
| --- | --- |
| `suno.dailyBudget` in `config-overrides.json` | Retired. It may remain in raw overrides for compatibility, but it is ignored by resolved config and no longer gates generation. |
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
