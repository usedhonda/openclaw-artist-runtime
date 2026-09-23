# Privacy

## Local data stored

Artist Runtime stores creative and operational data locally by default:

See also: `docs/ERRORS.md` for reason-code anchors related to credential
exposure concerns and operator-safe recovery paths.

- `ARTIST.md` and artist state files;
- song briefs, lyrics, YAML lyrics, Style, Exclude, Suno payloads;
- prompt-ledger JSONL files;
- audit logs;
- Suno run URLs and take notes;
- social post drafts/results;
- connector status metadata.

## Data sent to external services

Depending on enabled platforms, the plugin sends:

- Suno prompt payloads to Suno;
- posts/media to X, Instagram, or TikTok;
- OAuth authorization requests to Instagram/TikTok;
- Bird commands to local Bird CLI for X;
- Telegram Bot API requests only when the operator explicitly enables Telegram
  and provides a local bot token plus owner allowlist.

Connector credential contracts are local-only:

See `docs/CONNECTOR_AUTH.md` for the operator-facing setup and refresh flow.

- `OPENCLAW_INSTAGRAM_AUTH` / `OPENCLAW_INSTAGRAM_ACCESS_TOKEN` are read from the
  local shell environment when Instagram capability checks run.
- `OPENCLAW_TIKTOK_AUTH` / `OPENCLAW_TIKTOK_ACCESS_TOKEN` are read from the
  local shell environment when TikTok capability checks run.
- These environment variables are not copied into Prompt Ledgers, audit logs, or
  creative workspace files by design.
- X/Bird authentication stays inside the `bird` CLI's own cookie/token store;
  the plugin invokes the CLI but does not export, rewrite, or persist those
  cookies itself.
- Telegram free-text messages are not sent to any AI provider in the default
  skeleton. Future inbox handling must keep staged message text in local
  runtime JSONL files unless the operator explicitly enables a later workflow.
- Telegram bot tokens are read from the operator environment only and are not
  copied into `/api/status`, Producer Console payloads, Prompt Ledgers, audit
  logs, or creative workspace files.

## Suno profile boundary

- The Suno browser profile lives under `.openclaw-browser-profiles/suno/` on the
  operator filesystem only.
- It is not bundled into package artifacts and is not intended for network
  upload or workspace syncing.
- During the initial login flow, credentials are entered by the operator into
  Suno's own web UI through Chromium; the plugin does not capture or persist the
  credential body.
- The stealth plugin affects browser fingerprinting only; it does not add
  credential collection, storage, or new outbound data paths.
- The plugin's browser-driver lane should operate against that local profile
  without copying raw cookie contents into Prompt Ledgers, audit logs, or other
  human-readable artifacts.
- See `docs/SUNO_BROWSER_DRIVER.md` for the operator setup path.

## Suno artifact locality

- Imported Suno artifacts under `runtime/suno/<runId>/<trackId>.mp3|m4a` stay on
  the operator machine by default.
- Those files should not be shared, synced, or exported until the operator has
  explicitly reviewed them for the intended destination.
- The browser-profile cookie state under `.openclaw-browser-profiles/suno/`
  remains local-only as well, even when Chromium is launched through the Chrome
  channel for operator-managed login.
- Artist Runtime may index imported file paths and lightweight metadata, but it
  does not treat raw browser cookies as exportable runtime data.

## Suno artifact retention & deletion

- Artist Runtime does not auto-delete imported Suno artifacts under
  `runtime/suno/<runId>/`. The runtime keeps them in local operator storage
  until the operator decides otherwise.
- The same local-only boundary from `Suno artifact locality` still applies:
  `runtime/suno/<runId>/` remains on the operator machine unless the operator
  deliberately exports or backs it up.
- Before any sharing, export, or upload, the operator should manually review
  the retained artifacts for lyrics, metadata, and audio quality.
- If the operator decides to delete a run, the expected path is manual removal
  of `runtime/suno/<runId>/`. This package does not add an automatic script, UI
  button, or scheduled deletion flow for that action.
- Backups are an operator responsibility. If retained artifacts are copied to
  another disk or service, the operator must preserve the same local-only /
  controlled-access privacy boundary.

## Data not intentionally stored

- Passwords.
- Browser cookies in creative Markdown files.
- OAuth refresh tokens in Prompt Ledger or audit logs.
- Payment information.
- Connector environment-variable secrets in workspace files or package artifacts.

## Deletion

The implementation must provide documented deletion paths for:

- workspace creative files;
- Prompt Ledgers;
- audit logs;
- runtime connector state;
- dedicated browser profiles.

## Producer control

The producer must be able to pause autopilot and disable distribution from Producer Console without deleting the artist's creative archive.

## Retention policy summary

Artist Runtime does not auto-delete operator-side data. Retention is
operator-managed by design — the runtime keeps records in local workspace
storage until the operator explicitly removes them.

| Data class | Default retention | Auto-delete? |
|---|---|---|
| Workspace creative files (`ARTIST.md`, songs, lyrics, briefs) | Indefinite (operator-managed) | No |
| Prompt Ledger JSONL | Indefinite (operator-managed) | No |
| Audit logs (route, distribution, social-publish) | Indefinite (operator-managed) | No |
| Imported Suno artifacts under `runtime/suno/<runId>/` | Indefinite (operator-managed) | No |
| Connector status metadata (last-tested timestamps, account labels) | Indefinite (operator-managed) | No |
| Connector environment-variable secrets | Read at runtime only, never persisted to workspace files or audit logs | N/A |
| Browser-profile cookies/tokens under `.openclaw-browser-profiles/` | Operator-machine local only, never bundled or copied; lifetime is whatever the platform's session allows | No (operator deletes the profile directory to clear) |

If the operator decides to remove an item, manual deletion of the
corresponding workspace path is the expected flow. This package does not ship
scheduled deletion tasks, retention timers, or automatic shredding behavior.
