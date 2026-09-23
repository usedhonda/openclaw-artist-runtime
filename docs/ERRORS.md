# Error and Reason Catalog

Artist Runtime uses short reason codes so operators can trace a fail-closed
decision back to the source subsystem without exposing credentials or raw
platform responses.

See also: [OPERATOR_QUICKSTART.md](OPERATOR_QUICKSTART.md),
[TROUBLESHOOTING.md](TROUBLESHOOTING.md), [API_ROUTES.md](API_ROUTES.md),
[CONNECTOR_AUTH.md](CONNECTOR_AUTH.md), and
[SUNO_BROWSER_DRIVER.md](SUNO_BROWSER_DRIVER.md).

## Runbook anchors

These headings exist so Producer Console reason-code links can deep-link into
the catalog without relying on table-row rendering.

### requires_explicit_live_go
See the social distribution table entry for `requires_explicit_live_go`.

### dry-run-blocks-publish
See the social distribution table entry for `dry-run blocks publish`.

### dry-run-blocks-social-publish
See the social distribution table entry for `dry-run blocks social publish`.

### bird_cli_not_installed
See the social distribution table entry for `bird_cli_not_installed`.

### bird_auth_expired
See the social distribution table entry for `bird_auth_expired`.

### bird_probe_failed
See the social distribution table entry for `bird_probe_failed`.

### bird_rate_limited
See the social distribution table entry for `bird_rate_limited`.

### bird_compose_failed
See the social distribution table entry for `bird_compose_failed`.

### bird_dry_run_submit_failed
See the social distribution table entry for `bird_dry_run_submit_failed`.

### instagram_auth_not_configured
See the social distribution table entry for `instagram_auth_not_configured`.

### instagram_media_invalid
See the social distribution table entry for `instagram_media_invalid`.

### instagram_business_account_not_found
See the social distribution table entry for `instagram_business_account_not_found`.

### instagram_graph_accounts_failed_401
See the social distribution table entry for `instagram_graph_accounts_failed_401`.

### instagram_graph_accounts_failed_403
See the social distribution table entry for `instagram_graph_accounts_failed_403`.

### instagram_graph_accounts_failed_429
See the social distribution table entry for `instagram_graph_accounts_failed_429`.

### instagram_graph_media_failed_429
See the social distribution table entry for `instagram_graph_media_failed_429`.

### instagram_graph_publish_failed_500
See the social distribution table entry for `instagram_graph_publish_failed_500`.

### tiktok_account_not_created
See the social distribution table entry for `tiktok_account_not_created`.

### account_not_created
See the gateway and auth boundary table entry for `account_not_created`.

### budget_exhausted
See the Suno and budget table entry for `budget_exhausted`.

### budget_exhausted_monthly
See the Suno and budget table entry for `budget_exhausted_monthly`.

### playwright_create_timeout
See the Suno and budget table entry for `playwright_create_timeout`.

### playwright_create_network_error
See the Suno and budget table entry for `playwright_create_network_error`.

### playwright_create_dom_missing
See the Suno and budget table entry for `playwright_create_dom_missing`.

### playwright_create_login_expired
See the Suno and budget table entry for `playwright_create_login_expired`.

### playwright_create_rate_limited
See the Suno and budget table entry for `playwright_create_rate_limited`.

### gateway_token_mismatch
See the gateway and auth boundary table entry for `gateway_token_mismatch`.

### telegram_poll_failed
See the Telegram and debug review table entry for `telegram_poll_failed`.

### missing_owner_allowlist
See the Telegram and debug review table entry for `missing_owner_allowlist`.

### debug_ai_provider_not_configured
See the Telegram and debug review table entry for `debug_ai_provider_not_configured`.

## Operator runbook quick links

| Scenario | Primary reason codes | Runbook |
| --- | --- | --- |
| Credential exposure concern | `gateway_token_mismatch`, `bird_auth_expired`, credential-like boundary-grep hits | [TROUBLESHOOTING.md#credential-or-profile-exposure-concern](TROUBLESHOOTING.md#credential-or-profile-exposure-concern), `PRIVACY.md`, and [INCIDENT_RESPONSE.md#safe-incident-notes](INCIDENT_RESPONSE.md#safe-incident-notes) |
| Disk space exhausted or runtime growth | `playwright_create_network_error`, failed artifact imports, cleanup warnings | [TROUBLESHOOTING.md#disk-usage-warning](TROUBLESHOOTING.md#disk-usage-warning) and [RUNTIME_CLEANUP.md](RUNTIME_CLEANUP.md) |
| Frozen-platform attempt | `account_not_created`, `tiktok_account_not_created`, `instagram_auth_not_configured` after operator freeze | [TROUBLESHOOTING.md#igtiktok-frozen-attempt](TROUBLESHOOTING.md#igtiktok-frozen-attempt) and [INCIDENT_RESPONSE.md#scenario-3-publish-stuck-or-connector-blocked](INCIDENT_RESPONSE.md#scenario-3-publish-stuck-or-connector-blocked) for active platforms only |

## Social distribution

| Code | Source | Meaning | Operator recovery |
| --- | --- | --- | --- |
| `requires_explicit_live_go` | X / Instagram connectors | A non-dry-run publish reached the connector edge, but live social publishing is still blocked. | Confirm the platform-specific live GO has been granted before changing connector policy. |
| `dry-run blocks publish` | X / Instagram connectors | Dry-run staging succeeded or was blocked before live publish. | Expected in setup-safe mode; inspect `effectiveDryRun` in `/api/status`. |
| `dry-run blocks social publish` | `socialPublishing` authority guard | Upstream policy kept the request in dry-run, so the connector was not called. | Check `autopilot.dryRun`, `distribution.enabled`, global `liveGoArmed`, and the target platform arm. |
| `bird_cli_not_installed` | X / Bird connector | The `bird` CLI was not found. | Install/configure Bird on the operator machine and rerun the X platform probe. |
| `bird_auth_expired` | X / Bird connector | Bird reported an expired or invalid X session. | Refresh the Bird cookie/token store using `docs/CONNECTOR_AUTH.md`. |
| `bird_probe_failed` | X / Bird connector | Bird was present, but account probing failed for a non-auth-specific reason. | Run the Bird CLI manually in the operator shell and inspect its local output. |
| `bird_rate_limited` | X / Bird connector | Bird surfaced X rate-limit or temporary lock signals. | Wait for the platform window to clear; do not retry in a tight loop. |
| `bird_compose_failed` | X / Bird connector | The dry-run compose stage failed before submit preview. | Inspect the post text and Bird CLI output in the local operator shell. |
| `bird_dry_run_submit_failed` | X / Bird connector | The dry-run submit preview failed. | Treat this as a fail-closed staging failure; rerun the X probe before live GO. |
| `instagram_auth_not_configured` | Instagram connector | No accepted Instagram token env var is set. | Set `OPENCLAW_INSTAGRAM_AUTH` or `OPENCLAW_INSTAGRAM_ACCESS_TOKEN`, then reload the gateway shell. |
| `instagram_media_invalid` | Instagram connector | The requested media path list contains an empty value. | Regenerate or review the social asset payload before staging publish. |
| `instagram_business_account_not_found` | Instagram connector | Graph `/me/accounts` returned no page with an Instagram business account. | Link the Instagram account to a Facebook Page and confirm required scopes. |
| `instagram_graph_accounts_failed_401` | Instagram connector | Graph account lookup rejected the token as unauthorized. | Refresh the Instagram token and confirm `pages_show_list` scope. |
| `instagram_graph_accounts_failed_403` | Instagram connector | Graph account lookup was forbidden. | Check business/Page permissions and app review status. |
| `instagram_graph_accounts_failed_429` | Instagram connector | Graph account lookup was rate limited. | Pause retries and wait for the rate window. |
| `instagram_graph_media_failed_429` | Instagram connector | Media container creation was rate limited. | Pause publish staging and retry after the rate window. |
| `instagram_graph_publish_failed_500` | Instagram connector | Publish-stage Graph API returned a server error. | Keep the request fail-closed and retry only after Graph health recovers. |
| `tiktok_account_not_created` | TikTok connector | TikTok is intentionally frozen because the account lane is not created. | Do not configure TikTok until the operator explicitly opens that lane. |

## Suno and budget

| Code | Source | Meaning | Operator recovery |
| --- | --- | --- | --- |
| `budget_exhausted` | `SunoBudgetTracker` | The UTC-day Suno credit counter would exceed `dailyCreditLimit`. | Wait for UTC reset, adjust the config limit, or use the confirmed reset action. |
| `budget_exhausted_monthly` | `SunoBudgetTracker` | The optional monthly Suno counter would exceed `monthlyCreditLimit`. | Raise or disable the monthly limit only after reviewing actual spend. |
| `playwright_create_timeout` | Playwright Suno driver | Live create polling timed out. | Check the Suno page/session and rerun only if the prior create did not consume credits. |
| `playwright_create_network_error` | Playwright Suno driver | Browser navigation or network transport failed. | Confirm local connectivity and Suno availability. |
| `playwright_create_dom_missing` | Playwright Suno driver | Expected Suno form or result selectors were missing. | Treat as UI drift; update selectors before live use. |
| `playwright_create_login_expired` | Playwright Suno driver | The persistent Suno session appears expired. | Run the manual Suno login flow in `docs/SUNO_BROWSER_DRIVER.md`. |
| `playwright_create_rate_limited` | Playwright Suno driver | Suno surfaced a rate-limit style failure. | Pause generation and wait for the platform limit to clear. |

## Gateway and auth boundary

| Code | Source | Meaning | Operator recovery |
| --- | --- | --- | --- |
| `account_not_created` | Frozen platform status | A platform lane is intentionally unavailable. | Keep the platform disabled until account setup is complete. |
| `gateway_token_mismatch` | Gateway boundary docs | The gateway/plugin access boundary rejected the caller or used stale credentials. | Recheck `docs/GATEWAY_AUTH.md` and restart the gateway with the intended local env. |

## Telegram and debug review

| Code | Source | Meaning | Operator recovery |
| --- | --- | --- | --- |
| `missing_token` | Telegram bot worker | `telegram.enabled=true` but no local bot token is present. | Set `TELEGRAM_BOT_TOKEN` in the operator environment or disable Telegram again. |
| `missing_owner_allowlist` | Telegram bot worker | The bot has no allowed Telegram owner ids. | Set `TELEGRAM_OWNER_USER_IDS`; keep the list limited to the operator. |
| `telegram_poll_failed` | Telegram bot worker | Long-polling failed or Telegram returned a transport/API error. | Keep the worker in backoff, verify local network, and retry `/status`; do not paste token bodies into logs. |
| `debug_ai_provider_not_configured` | Debug AI review | A non-mock debug provider was selected but no real provider is wired. | Switch `aiReview.provider` back to `mock` or configure a future provider in a separate change. |
| `debug_review_song_missing` | Telegram `/review` command | The requested song material does not exist or cannot be read. | Check `/songs`, then rerun `/review <songId>` with an existing song id. |
