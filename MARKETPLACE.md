# Marketplace Listing Draft

## Name

Artist Runtime

## Short description

Run OpenClaw as a public autonomous AI musician that creates songs with Suno and shares them to X, Instagram, and TikTok.

## Long description

Artist Runtime turns an OpenClaw agent into a public artist daemon. It maintains an artist identity, creates songs from its own ongoing interests, generates Suno prompt packs, operates a logged-in Suno browser worker, selects takes, creates social assets, and publishes to producer-selected platforms within configured budgets and hard-stop rules.

## Key features

- Public artist identity and memory.
- Suno-first music production.
- Full prompt and payload ledger.
- X distribution through Bird.
- Instagram/TikTok publishing connectors.
- Producer Console for setup, status, settings, logs, and recovery.
- Autopilot with budgets, cadence, and hard stops.
- Audit log for external side effects.

## Required disclosures

This plugin can consume Suno credits and publish publicly to connected social accounts when autopilot and distribution are enabled. Configure budgets and dry-run mode before enabling production autopilot.

## Connector credentials summary

- **X (Bird):** requires the `bird` CLI on `PATH` plus Bird's own authenticated local cookie/token store.
- **Instagram:** uses `OPENCLAW_INSTAGRAM_AUTH` or `OPENCLAW_INSTAGRAM_ACCESS_TOKEN` for env-based capability checks.
- **TikTok:** uses `OPENCLAW_TIKTOK_AUTH` or `OPENCLAW_TIKTOK_ACCESS_TOKEN` for env-based capability checks.

See also:

- `docs/CONNECTOR_AUTH.md` for the operator-facing setup and refresh guide
- `CAPABILITIES.md` for connector contracts and fail-closed behavior
- `SECURITY.md` for secret handling boundaries
- `PRIVACY.md` for local-only credential storage expectations
- `PUBLISHING.md` for release checklist requirements

## Credential refresh troubleshooting

If a connector stops reporting `connected: true`, re-authenticate Bird or refresh
the Instagram/TikTok env vars, then rerun `POST /plugins/artist-runtime/api/platforms/{id}/test`.
Check Producer Console `Platforms` / `Status` before retrying distribution, and
do not paste connector secrets into ledgers, package files, or repository docs.
For platform-by-platform steps, use `docs/CONNECTOR_AUTH.md`.

## Suggested tags

music, suno, artist, social, x, instagram, tiktok, automation, creator-tools, public-agent

## Screenshots to add before publication

- Setup wizard.
- Suno status page.
- Platform selection page.
- Prompt Ledger view.
- Autopilot dashboard.
- Audit log view.

## Packaging strategy

Initial release may ship as one package. Future public distribution should consider splitting optional high-permission connectors:

- `@your-org/openclaw-artist-runtime` core;
- `@your-org/openclaw-artist-suno`;
- `@your-org/openclaw-artist-social-x-bird`;
- `@your-org/openclaw-artist-social-instagram`;
- `@your-org/openclaw-artist-social-tiktok`.
