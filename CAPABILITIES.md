# Capabilities

This document is part of the marketplace disclosure. Keep it accurate.

## Tools

- `artist_song_ideate` — create song ideas from artist state.
- `artist_suno_create_prompt_pack` — create Style, Exclude, YAML lyrics, sliders, and payload JSON.
- `artist_suno_generate` — execute Suno generation through the configured connection mode.
- `artist_suno_import_results` — import Suno URLs/take metadata.
- `artist_take_select` — evaluate and select generated takes.
- `artist_social_publish` — publish configured social content.
- `artist_social_reply` — reply to social mentions when allowed.

## Hooks

- `agent:bootstrap` — inject artist state and operating policy.
- `before_tool_call` — enforce MusicAuthority/SocialAuthority.
- `after_tool_call` — append audit events.

## Services

- `artistAutopilotService` — runs production cycles.
- `sunoBrowserWorker` — manages Suno browser profile and generation runs.
- `SunoBrowserService` — plugin-owned Suno browser lifecycle: launches the single
  persistent profile with an ephemeral CDP port for the Console connect flow, the
  captcha human-assist fallback, and the vendored suno-cli captcha mint. Never
  launches at boot or on a status read.
- `socialDistributionWorker` — converts selected takes into platform-specific posts.

## HTTP routes

- `/plugins/artist-runtime` — Producer Console.
- `/plugins/artist-runtime/api/*` — setup/status/settings/ledger/recovery APIs.

## External side effects

When enabled and configured, this plugin can:

- operate a logged-in Suno browser profile;
- create Suno generations and consume credits;
- publish to X through Bird;
- publish to Instagram through Meta APIs;
- publish to TikTok through TikTok APIs;
- store local prompt ledgers, audit logs, and creative assets.

## Connector contracts

Detailed setup and refresh steps live in `docs/CONNECTOR_AUTH.md`.

### X (Bird)

- Requires the `bird` CLI to be installed and available on `PATH`.
- Connection checks use `bird --help` and `bird whoami --plain`.
- Bird authentication is expected to come from the Bird CLI's own config/cookie store.
- If the CLI is missing or auth is expired, the connector fails closed and reports
  `bird_cli_not_installed` or `bird_auth_expired`.

### Instagram

- Current dry-run skeleton checks for one of:
  - `OPENCLAW_INSTAGRAM_AUTH`
  - `OPENCLAW_INSTAGRAM_ACCESS_TOKEN`
- If neither variable is present, the connector reports
  `instagram_auth_not_configured`.
- Publish/reply remain fail-closed until an official API adapter is implemented.

### TikTok

- TikTok is currently frozen at the connector boundary while the operator
  account is not created.
- `/api/platforms/tiktok/test` reports `account_not_created` regardless of
  local env state, and the Producer Console keeps the probe control disabled.
- Publish/reply remain fail-closed until an official API adapter is implemented.

## Hard stops

The plugin must stop and surface an alert on:

- login challenge;
- CAPTCHA or bot challenge;
- payment prompt or credit purchase flow;
- missing platform capability;
- quota exhaustion;
- high-risk content classification;
- credential storage/logging attempt;
- UI mismatch in browser automation.
