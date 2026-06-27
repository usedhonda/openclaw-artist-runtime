# OpenClaw Artist Runtime

OpenClaw Artist Runtime turns an OpenClaw agent into a **public autonomous AI musician**.
It runs on a Mac as an OpenClaw plugin, creates songs from its own artistic state,
generates music with Suno, and shares finished or in-progress work to selected
public platforms such as X, Instagram, and TikTok.

This repository is structured as a **distribution-ready OpenClaw native plugin package**.
It is intended to be published to ClawHub and/or npm after implementation and review.

## Requirements

- **macOS** — the Suno browser lane and operator helper scripts are built and
  tested on macOS.
- **Node.js >= 20.**
- **A host OpenClaw install** with the `openclaw` CLI on `PATH`. This package is
  an OpenClaw plugin loaded by the gateway, not a standalone app.
- **For the live Suno browser lane:** a Playwright Chromium binary
  (`npx playwright install chromium`) plus a logged-in Suno browser profile.
- **For X distribution:** the `bird` CLI on `PATH` with an authenticated local
  session.
- Instagram and TikTok are optional, frozen lanes and need no setup by default.

## Product stance

Artist Runtime is not a private writing assistant. It is a public artist daemon.

The producer chooses:

- which platforms the artist uses;
- how far Suno generation may run autonomously;
- which social post types can be published automatically;
- budgets, cadence, and hard stops;
- how much reporting the producer receives.

## Install shape

After publication, the target install command is:

```bash
openclaw plugins install clawhub:@yzhonda/openclaw-artist-runtime
```

or, if using npm fallback:

```bash
openclaw plugins install npm:@yzhonda/openclaw-artist-runtime
```

## For operators

If you installed this plugin through OpenClaw or npm, the published tarball
contains everything needed to run and operate the artist daemon. Start here:

- `docs/OPERATOR_QUICKSTART.md` — gateway start, probes, arm flags, dry-run
  verification, and the explicit live-publish handoff boundary.
- `docs/PRODUCER_CONSOLE.md` — Producer Console reference for the bundled UI
  and the fallback inline shell.
- `docs/OPERATOR_RUNBOOK.md` — manual doctor, log rotation, and runtime state
  snapshot helpers.
- `docs/TROUBLESHOOTING.md` — symptom-first recovery decision tree linked to
  reason-code anchors.
- `docs/ERRORS.md` — compact reason-code catalog for Console badges, logs, and
  incident notes.
- `docs/CONNECTOR_AUTH.md` and `docs/GATEWAY_AUTH.md` — credential probes for
  X (Bird), Instagram, TikTok, and the gateway auth surface.
- `docs/API_ROUTES.md` — live plugin HTTP route catalog.

For a security-sensitive report, follow `SECURITY.md`. For data retention and
local-state policy, see `PRIVACY.md`.

## Current status

This package now includes a working dry-run runtime with a bundled Producer Console,
repo-local OpenClaw sandbox tooling, persisted-config-aware routes, live-safe route
dispatch under the current OpenClaw Gateway matcher, and CI regression gates on
`main` pushes and pull requests.

- Full-cycle smoke tests cover `planning → prompt_pack → suno_generation →
  take_selection → asset_generation → publishing (dry-run) → completed`, and a
  second rotation into `song-002`, with zero external calls (`spawn` and `fetch`
  are mocked and asserted unused).
- Producer Console exposes a live config editor for `autopilot` and
  `distribution.platforms.*`, ticker status, recent X dry-run results, and a
  dry-run simulate-reply form backed by plugin API routes only.
- Producer Console config editing now covers both platform enablement and
  `distribution.platforms.*.authority`, so X / Instagram / TikTok safety modes
  can be switched live from the bundled UI or the fallback inline shell.
- Connector readiness is now documented end to end: X uses the `bird` CLI and
  its local auth store, while Instagram and TikTok expose env-based auth probe
  contracts through `CAPABILITIES.md` and `SECURITY.md` so operators know which
  credentials must exist before any live authority is enabled.
- Producer Console now surfaces Suno worker lifecycle and automation outcomes end
  to end: `currentRunId`, `lastImportedRunId`, `lastCreateOutcome`, and
  `lastImportOutcome` are exposed from `/api/suno/status` and rendered in both
  the bundled React UI and the fallback inline Console.
- The Suno outcome surface is now isolated into a dedicated compact component
  with explicit dry-run badges on the latest create/import outcomes, so the
  operator can distinguish simulated automation from future live worker results
  at a glance.
- All read routes, mutating routes, and `/api/config/update` now resolve config
  through the same persisted runtime-config pattern, so Console behavior is
  consistent when `runtime/config-overrides.json` is present.
- Route dispatch is now hardened against the current OpenClaw Gateway's literal
  `:param` matcher behavior: platform test routes are registered statically and
  the `songs`, `alerts`, `platforms`, and `suno` API families use prefix
  dispatch so the existing URLs still work live.
- Suno worker automation now has a full mock-only skeleton: lifecycle state,
  manual login handoff, create/import driver contracts, connector wiring, and
  persisted outcomes are all in place without executing a real browser or Suno run.
- Social connector skeletons are now aligned across all three platforms:
  X/Bird, Instagram, and TikTok each expose auth probing plus fail-closed
  publish/reply behavior, with Instagram/TikTok staying mock-only and dry-run-safe.
- Repo-local verification includes `scripts/openclaw-local-gateway`,
  `scripts/openclaw-local-http-smoke.sh`, `scripts/openclaw-local-write-smoke.sh`,
  and `scripts/openclaw-local-ticker-observe.sh`.
- The repo now includes a GitHub Actions CI workflow that runs `typecheck`, `test`,
  and `build` on pushes and pull requests to `main`.
- CI regression gates have stayed stable through repeated post-fix runs, including
  the workspace-template tracking correction and the lock-file-free workflow update.
- `workspace-template/artist/*` and `workspace-template/songs/.gitkeep` are tracked,
  so fresh CI/workspace bootstrap runs get the same artist files as local development.
- Real Bird / Instagram / TikTok posting, real Suno browser automation, and real
  platform writes are **not** enabled by default and require explicit operator action.
- `autopilot.dryRun` defaults to `true`; the plugin ships safe-by-default.
- Producer Console uses a bundled React app from `ui/dist/` when available and falls
  back to an inline inspection shell when the bundle is missing or stale.

See `CHANGELOG.md` for the active feature set.

## Key package files

- `openclaw.plugin.json` — manifest, config schema, UI hints, capability declaration.
- `package.json` — npm/ClawHub package metadata and OpenClaw compatibility block.
- `SECURITY.md` — credential, browser profile, external action, and reporting policy.
- `PRIVACY.md` — local data, ledgers, external transmissions, deletion model.
- `CAPABILITIES.md` — exact advertised tools, hooks, services, routes, side effects.
- `PUBLISHING.md` — ClawHub/npm pre-publish checklist.
- `MARKETPLACE.md` — listing copy, disclosure text, and packaging strategy.

## Runtime architecture

```text
OpenClaw Gateway
  └─ Artist Runtime plugin
      ├─ Producer Console HTTP route
      ├─ Autopilot service
      ├─ Suno Browser Worker
      ├─ Social Distribution Worker
      ├─ Tools / Hooks / Authority Guards
      ├─ Prompt Ledger / Audit Log
      └─ Connectors: Bird, Instagram, TikTok
```

## Safety defaults

The package schema includes autonomous defaults because the product is a public
artist daemon, but `autopilot.dryRun` defaults to true. Production release must make
initial setup explicit before external side effects occur.

Hard stops are mandatory:

- login challenge;
- CAPTCHA;
- payment prompt;
- UI mismatch;
- policy uncertainty;
- platform capability failure.

## Suno

Suno integration is designed around a background logged-in browser profile or a manual
copy fallback. It must not use CAPTCHA bypass, credential capture, or non-consensual
voice/artist imitation flows.

The bundled Suno knowledge pack includes `sunomanual` material by usedhonda
(Copyright 2025-2026) under MIT. The Artist Runtime code remains under
its own repository license, while the copied knowledge files and embedded
lyrics/style prompt instructions retain their `sunomanual` attribution and
MIT attribution notice in `NOTICE.md`.

For distribution installs that use the live Suno browser worker, bring your own
local Chrome session and attach through Chrome DevTools Protocol (CDP) on the
loopback interface:

```bash
bash scripts/start-chrome-cdp.sh
```

The helper starts Chrome with CDP on port `9222`. Keep CDP bound to
`127.0.0.1`; an open debugging port is a local attack surface that can control
the browser. Run this Chrome only when Suno work is needed, close it when the
worker is idle, and avoid running untrusted local apps while the port is open.

Before any live Suno use, run the doctor from the package root:

```bash
bash scripts/suno-doctor.sh
```

The doctor is a connection/readiness check, not a generation flow. It must not
click Create, submit a form, spend credits, or publish anything. The distributed
CDP setup does not require Tampermonkey, userscripts, clipboard injection, or
browser extensions.

Every Suno run must persist the complete prompt lineage before any generation action:

- artist snapshot;
- song brief;
- lyrics and YAML lyrics;
- Style and Exclude;
- sliders;
- Suno payload JSON;
- payload hash;
- run metadata;
- take evaluation;
- social derivative prompts.

## Producer Console bundle

The plugin serves a built Producer Console from `ui/dist/` when present.
If the bundle is missing, the plugin falls back to a minimal inline Console shell for safe inspection-only use.
The bundled Console includes the config editor, platform authority selectors,
ticker/status cards, recent X result surface, Suno outcome cards, and
auto-refresh polling; the fallback Console keeps the same core control tower
actions available for safe operation.

To build just the Console:

```bash
npm run build:ui
```

## For contributors

Contributors should clone the repository (the published tarball intentionally
omits source, internal specs, and developer scripts).

```bash
git clone https://github.com/yzhonda/openclaw-artist-runtime.git
cd openclaw-artist-runtime
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run pack:verify
```

`npm run build` builds both the runtime TypeScript output and the Producer Console bundle.
The UI bundle is built from `ui/` and included in package verification.

For a repo-local OpenClaw sandbox install that avoids `~/.openclaw`, see
`docs/15_LOCAL_OPENCLAW_SANDBOX.md`.

For a repo-local Gateway smoke run after install, use:

```bash
scripts/openclaw-local-gateway start
scripts/openclaw-local-http-smoke.sh
scripts/openclaw-local-write-smoke.sh
scripts/openclaw-local-gateway stop
```

Internal entry points:

- `AGENTS.md` and `CODEX_START_HERE.md` — agent contribution guides.
- `docs/full-spec/` — original detailed engineering specification
  (`PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `SUNO_SPEC.md`,
  `SOCIAL_CONNECTORS_SPEC.md`, `PROMPT_LEDGER_SPEC.md`).
- `docs/codex-detailed-specs/` — supplementary specs.
- `MARKETPLACE.md` and `PUBLISHING.md` — marketplace listing and pre-publish checks.

Before tagging a public release, update:

- repository URLs;
- author/license metadata;
- compatibility versions;
- OAuth application IDs and documentation;
- marketplace screenshots and demo flow.

Bug reports and feature requests use the templates under `.github/ISSUE_TEMPLATE/`.
Pull requests follow `.github/PULL_REQUEST_TEMPLATE.md`. Security-sensitive findings
must use GitHub Security Advisories rather than public issues.
