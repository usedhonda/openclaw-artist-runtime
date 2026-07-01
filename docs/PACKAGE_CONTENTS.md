# Package contents and rationale

This document describes what is shipped in the published OpenClaw Artist
Runtime tarball (the `npm pack` / ClawHub artifact) and what stays in the
repository for contributors only.

The published tarball is intentionally narrow: it carries the operator
runtime, the bundled Producer Console, marketplace metadata, operator-facing
documentation, and the operator helper scripts. Source code, tests, internal
specifications, contributor guides, and the repo-local sandbox scripts
(`scripts/openclaw-local-*`) stay in the GitHub repository and are not part of
the marketplace artifact.

## What ships in the marketplace tarball

The `files` array in `package.json` controls the tarball. Current contents:

### Runtime artifacts

- `dist/**/*.js` — compiled TypeScript runtime entry points loaded by the
  OpenClaw Gateway. Type declarations stay repository-local because the
  package does not expose a public TypeScript API.
- `ui/dist/index.html` — the built, self-contained Producer Console bundle
  served by the plugin from `ui/dist/`.
- `templates/**` — install-time templates (`ARTIST.md`, `CURRENT_STATE.md`,
  `HEARTBEAT.md`, `SONGBOOK.md`). Persona runtime writes target the live
  workspace, not repository-root package files.
- `prompts/**` — prompt fragments (`suno-style-generation.md`,
  `suno-yaml-lyrics.md`, `take-selection.md`).
- `schemas/**` — JSON Schema files (`config.schema.json`,
  `audit-event.schema.json`, `prompt-ledger.schema.json`).
- `workspace-template/**` — the artist workspace skeleton seeded into a
  fresh operator workspace, including `artist/*.md` files and an empty
  `songs/` placeholder.
- `config.default.json` — bundled default config.
- `openclaw.plugin.json` — OpenClaw manifest (config schema, capabilities,
  UI hints, version).

### Marketplace metadata

- `LICENSE`, `NOTICE.md`, `README.md`, `CHANGELOG.md`
- `CAPABILITIES.md` — advertised tools, hooks, services, routes, side
  effects.
- `MARKETPLACE.md` — listing copy, disclosure text, packaging strategy.
- `PRIVACY.md` — local data retention policy.
- `SECURITY.md` — credential and reporting policy (GitHub Security
  Advisories flow).
- `CONTRIBUTING.md` — short contribution pointers.
- `PUBLISHING.md` — pre-publish checklist.

### Operator documentation

- `docs/OPERATOR_QUICKSTART.md` — gateway start, probes, arm flags,
  dry-run verification, live-publish handoff boundary.
- `docs/OPERATOR_RUNBOOK.md` — manual doctor, log rotation, runtime state
  snapshot helpers.
- `docs/PRODUCER_CONSOLE.md` — bundled Console reference (config editor,
  platform authority selectors, ticker / Suno outcome cards).
- `docs/PERSONA_CANONICAL.md` — five-file persona ownership, generated
  projections, and runtime-managed state rules.
- `docs/RUNTIME_SETTINGS.md` — settings layers, precedence, env-only
  diagnostics, and retired legacy values.
- `docs/CONNECTOR_AUTH.md` — connector setup / refresh guide for Bird
  (X), Instagram, TikTok.
- `docs/GATEWAY_AUTH.md` — plugin-level gateway auth boundary.
- `docs/API_ROUTES.md` — live plugin HTTP route catalog.
- `docs/TROUBLESHOOTING.md` — symptom-first recovery decision tree linked
  to reason-code anchors.
- `docs/ERRORS.md` — operator-facing reason-code catalog.
- `docs/SUNO_BROWSER_DRIVER.md` — operator-facing Suno browser-profile
  lane guide.
- `docs/RUNTIME_CLEANUP.md` — runtime retention and cleanup guide.
- `docs/INCIDENT_RESPONSE.md` — operator incident response runbook.
- `docs/X_LIVE_PUBLISH_DESIGN.md` — staged X live publish state machine.
- `docs/PACKAGE_CONTENTS.md` — this file.

### Operator scripts

The package also ships the operator-facing helper scripts that the documentation
above references (run from the package root):

- `scripts/openclaw-doctor.sh`, `scripts/suno-doctor.sh` — readiness/health checks.
- `scripts/openclaw-suno-login.sh`, `scripts/openclaw-suno-login.mjs`,
  `scripts/start-chrome-cdp.sh`, `scripts/suno-profile-diagnose.sh` — Suno
  browser-lane login and diagnosis.
- `scripts/reset-config.sh` — config rollback.
- `scripts/rotate-runtime-logs.sh`, `scripts/snapshot-runtime-state.sh`,
  `scripts/runtime-disk-usage.sh`, `scripts/cleanup-runtime.sh`,
  `scripts/runtime-retention-enforce.sh` — runtime maintenance.
- `scripts/import-obsidian-artist.mjs`, `scripts/import-obsidian-song.mjs` —
  optional Obsidian archive import (`--source <path>`).

The repo-local OpenClaw sandbox wrappers (`scripts/openclaw-local-*`) are **not**
shipped; they stay in the repository for contributors.

A `npm pack --dry-run` against the current `package.json` produces the tarball
described here; the exact file count and size grow as operator docs and scripts
are added.

## What stays in the repository only

The following paths are present in the GitHub repository but excluded
from the marketplace tarball via `package.json:files` and `.npmignore`.
They are meant for contributors and runtime developers:

- `src/**`, `tests/**` — TypeScript sources and the test suite.
- `scripts/openclaw-local-*` — repo-local OpenClaw sandbox helpers and smoke
  tests, plus build/verification tooling (`build-knowledge-bundle.mjs`,
  `boundary-grep.mjs`, `verify-package.mjs`). Operator-facing scripts ship in the
  tarball (see "Operator scripts" above).
- `ui/src/**`, `ui/vite.config.ts` — Producer Console source (the built
  bundle ships under `ui/dist/`).
- `AGENTS.md`, `CODEX_START_HERE.md`, `SPEC_INDEX.md` — agent
  contribution guides.
- `docs/full-spec/` — original detailed engineering specification
  (`PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `SUNO_SPEC.md`,
  `SOCIAL_CONNECTORS_SPEC.md`, `PROMPT_LEDGER_SPEC.md`).
- `docs/codex-detailed-specs/` — supplementary specs.
- `docs/log/`, `docs/ask/`, `docs/SOURCE_NOTES.md` — agent activity logs
  and decision notes.
- Numbered planning specs (`docs/00_*` through `docs/15_*`).
- `.github/workflows/` — CI, release, CodeQL workflows.
- `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`,
  `.github/dependabot.yml` — repo metadata.
- `reference/original-starter-scaffold/` — earlier scaffold retained for
  history.

Contributors clone the repository, run `npm install && npm test`, and
follow `AGENTS.md` and the entries in `docs/full-spec/` to understand the
runtime. The README "For contributors" section enumerates the entry
points.

<a id="excluded-paths-for-distribution"></a>

## Excluded paths (must never ship)

These paths must stay out of the npm / ClawHub tarball, public PR
attachments, and audit-log fixtures:

- `.local/`
- `.env` and `.env.*`
- `runtime/`
- `.openclaw-browser-profiles/`
- `.openclaw-browser-profiles/suno/`
- `runtime/suno/*.tmp` and `runtime/suno/**/*.tmp`
- `ui/node_modules/`
- generated package tarballs (`*.tgz`)

The package must not contain operator credentials, browser profiles,
local runtime counters, imported Suno audio, temporary budget files, or
local workspace state.

## Connector auth surface (shipped reference)

`CAPABILITIES.md`, `SECURITY.md`, and `docs/CONNECTOR_AUTH.md` carry the
connector auth contract for distribution operators:

- X requires the `bird` CLI plus its authenticated local session store,
  with optional `OPENCLAW_X_FIREFOX_PROFILE` for dedicated artist Firefox
  profiles.
- Instagram probes `OPENCLAW_INSTAGRAM_AUTH` /
  `OPENCLAW_INSTAGRAM_ACCESS_TOKEN`.
- TikTok probes `OPENCLAW_TIKTOK_AUTH` /
  `OPENCLAW_TIKTOK_ACCESS_TOKEN`.

`SECURITY.md` and `PRIVACY.md` document the Suno browser-profile
boundary: `.openclaw-browser-profiles/suno/` stays local-only, and
imported audio under `runtime/suno/<runId>/` remains operator-reviewed
local storage by default.

## Distribution stance

The published package defaults to a safe setup state
(`autopilot.dryRun` is `true`, all platforms ship without `liveGoArmed`).
The product goal is autonomous public artist operation, but the operator
must explicitly enable live autopilot and platform-specific publishing
through the Producer Console after install.
