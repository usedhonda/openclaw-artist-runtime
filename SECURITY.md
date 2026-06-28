# Security Policy

## Supported versions

Only the latest minor version is supported until the implementation stabilizes.

## Reporting vulnerabilities

Report security issues privately through GitHub Security Advisories on this
repository (Security tab → "Report a vulnerability" → "Privately report a
vulnerability"). Do not file public GitHub issues for security topics.

We aim to acknowledge new reports within 5 business days. Resolution timing
depends on severity; high-severity issues are prioritised. After a fix lands
we publish coordinated advisory notes through the same Security Advisories
flow before any public discussion.

## Security model

Artist Runtime is powerful. It can operate logged-in browser sessions, generate music, and publish publicly.
Therefore all external side effects must pass authority checks and audit logging.

## Gateway auth boundary

The plugin route surface currently relies on the OpenClaw Gateway's plugin-level
access boundary rather than per-route auth logic inside the plugin. See
`docs/GATEWAY_AUTH.md` for the operator-facing explanation and deployment
recommendations.

## Credential handling

- Do not store Suno passwords.
- Do not store X, Instagram, TikTok passwords.
- Do not write OAuth refresh tokens, cookies, browser session headers, or API keys into Markdown ledgers.
- Store connector secrets only in OpenClaw-approved secret/runtime storage or the platform's dedicated browser profile.
- Redact secrets from logs and error messages.

### Connector secret contract

For platform-by-platform setup and refresh flow, see `docs/CONNECTOR_AUTH.md`.

- `XBirdConnector` does not read passwords from plugin config. It depends on the
  local `bird` CLI and that CLI's own authenticated cookie/token store.
- `InstagramConnector` currently checks only these environment variables:
  - `OPENCLAW_INSTAGRAM_AUTH`
  - `OPENCLAW_INSTAGRAM_ACCESS_TOKEN`
- `TikTokConnector` currently checks only these environment variables:
  - `OPENCLAW_TIKTOK_AUTH`
  - `OPENCLAW_TIKTOK_ACCESS_TOKEN`
- `TelegramBotWorker` starts only when all three local opt-in gates are present:
  - `telegram.enabled=true` in non-secret config
  - `TELEGRAM_BOT_TOKEN` in the operator environment
  - `TELEGRAM_OWNER_USER_IDS` with at least one allowed numeric user id
- These values must be treated as secrets:
  - do not commit them
  - do not place them in `workspace-template/**`
  - do not echo them in shell history, screenshots, Prompt Ledger entries, audit logs, or error text
- Missing or expired connector credentials must fail closed. The plugin should
  surface a diagnostic reason rather than attempting a best-effort publish.

### Telegram bot token

- The Telegram bot token is local-only operator secret state. Keep it in
  `.local/social-credentials.env` or an equivalent shell environment, never in
  plugin config, package files, docs examples with real values, Prompt Ledgers,
  audit logs, screenshots, or chat transcripts.
- `scripts/openclaw-local-env.sh print` reports only whether the token is set;
  it must not print the token body.
- The owner allowlist is non-secret but still local operator configuration. If
  the allowlist is empty, the worker stays disabled even when a token exists.

## Browser profile handling

The Suno Browser Worker uses a dedicated browser profile. It must not read the operator's ordinary browser profile.
It must stop on login challenge, CAPTCHA, payment prompt, or unexpected UI.

## Suno browser profile

- `.openclaw-browser-profiles/suno/` is operator-machine-local state only.
- The path is excluded from git and must never be copied into package tarballs,
  ledgers, audit logs, screenshots, or repository docs.
- The plugin may automate a browser against that profile in later rounds, but
  it must not dump cookie bodies or session-token contents into readable
  artifacts.
- Initial Suno login is an operator-only manual action through
  `scripts/openclaw-suno-login.sh`. Automation, CI, and unattended autopilot
  must not execute that flow automatically.
- The stealth plugin only suppresses automation-identification markers for the
  browser session; it does not change credential storage rules or expand what
  secrets the plugin may read or persist.
- For operator setup flow, see `docs/SUNO_BROWSER_DRIVER.md`.

## Suno browser credentials

- `.openclaw-browser-profiles/suno/` is local-only credential state on the
  operator machine; it is never part of the repository, CI artifacts, or npm /
  ClawHub package tarballs.
- Profile cookies and session tokens inside that directory are secrets. Do not
  paste them into PRs, logs, screenshots, chat transcripts, shell history, or
  incident notes.
- The Playwright Suno lane uses `launchPersistentContext` against that profile
  instead of copying cookies into config or ledgers.
- `.gitignore` already excludes the browser-profile directory. That exclusion is
  part of the security boundary and must remain in place for operator-managed
  login sessions.

## Public side effects

Public actions include Suno generation, X posts, Instagram posts, TikTok posts, replies, quote posts, and release announcements.
All public actions require:

1. authority decision;
2. risk classification;
3. budget/cadence check;
4. audit log event;
5. Prompt Ledger link where applicable.

## Audit log safe field list

Audit logs may include operational metadata needed to explain what happened:

- timestamp
- route or tool name
- platform id
- song id, run id, take id, or audit event id
- authority decision type
- dry-run / accepted / blocked status
- redacted public URL or platform post URL after publication
- non-secret reason strings such as `budget_exhausted`,
  `requires_explicit_live_go`, or `login_required`

Audit logs must not include:

- access tokens, OAuth refresh tokens, API keys, passwords, cookies, or browser
  session headers
- raw request or response bodies from Suno, Meta, Bird, or other platform tools
- contents of `.local/`, `.env`, `.openclaw-browser-profiles/`, or connector
  credential stores
- screenshots or copied browser storage from signed-in sessions

## Dependency audit policy

CI runs `npm audit --audit-level=moderate --omit=dev` as a fail-closed
production dependency gate. Moderate-or-higher production advisories must be
cleared before release, normally through root `overrides` that keep the plugin
on the existing framework line and then pass typecheck, tests, build, coverage,
and boundary-grep.

Development-only advisories are not silently ignored. When the fix requires a
test-framework or build-tool major upgrade, such as the Vitest 2 to Vitest 4
path for Vite/esbuild dev-server advisories, the project keeps the existing
framework line until the producer explicitly approves that architectural
change. The accepted risk is limited to local/CI development tooling, not the
distributed plugin runtime.

## Marketplace note

Because plugin marketplaces are sensitive surfaces, this package must not ask users to run arbitrary shell commands beyond standard install/build/test instructions. Avoid obfuscated scripts and lifecycle `postinstall` behavior.
