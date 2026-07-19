# Publishing Guide

## Preconditions

Before publishing:

- Replace `@your-org` with the actual package scope.
- Replace repository, homepage, bugs, and author metadata.
- Verify current OpenClaw SDK entry points and compatibility values.
- Ensure `openclaw.plugin.json` is in the package root.
- Ensure `package.json.openclaw.extensions` points to built output.
- Ensure `package.json.openclaw.compat.pluginApi` and `minGatewayVersion` are present.
- Ensure no lifecycle `postinstall` scripts are required.
- Ensure no secrets, local profiles, songs, or runtime files are included.
- Ensure `SECURITY.md`, `PRIVACY.md`, `CAPABILITIES.md`, and `MARKETPLACE.md` are current.
- Ensure `docs/CONNECTOR_AUTH.md` is current if connector setup or refresh flow changed.
- Ensure `docs/GATEWAY_AUTH.md` still matches the actual gateway/plugin auth boundary.
- Ensure `ui/node_modules` is not included in the tarball.
- If connector verification is part of the release check, ensure operator-local
  auth prerequisites are present before testing:
  - X uses the `bird` CLI plus its authenticated local cookie/token store.
  - Instagram uses `OPENCLAW_INSTAGRAM_AUTH` or `OPENCLAW_INSTAGRAM_ACCESS_TOKEN`.
  - TikTok uses `OPENCLAW_TIKTOK_AUTH` or `OPENCLAW_TIKTOK_ACCESS_TOKEN`.
- Ensure those credentials remain local-only (shell profile / env injection) and
  are not written into logs, package files, or committed `.env` files.
- Use `docs/CONNECTOR_AUTH.md` as the operator-facing source of truth for setup,
  refresh, and connector health checks.

## Vendored suno-cli

The Suno create/download CLI is vendored under `vendor/suno-cli/` (compiled
`dist/src/**`, plus `package.json`, `LICENSE`, `README.md`, and a `VENDOR_COMMIT`
provenance stamp). It ships in the package and backs the connector's entry
auto-resolution (`music.suno.cliEntry` config > `OPENCLAW_SUNO_CLI_ENTRY` env >
vendored copy), so operators do not need a separate checkout or an absolute path.

Re-sync whenever suno-kit's CLI changes:

```bash
# Default source: ../../docs/suno-kit/suno-cli (override via arg or SUNO_CLI_SRC)
scripts/sync-suno-cli-vendor.sh
# or point at an explicit checkout:
scripts/sync-suno-cli-vendor.sh /path/to/suno-kit/suno-cli
```

The script builds the CLI (`npm run build`), refuses to vendor a build missing the
`token_validation_failed` (blocked_captcha 422) classification, copies the built
`dist/src` and metadata into `vendor/suno-cli/`, and records the source commit in
`vendor/suno-cli/VENDOR_COMMIT`. Verify and commit the result:

```bash
grep -rq token_validation_failed vendor/suno-cli/dist/src && echo ok
npm run typecheck && npm test
git add vendor/suno-cli && git commit -m "chore(vendor): re-sync suno-cli"
```

The vendored `dist/` is intentionally exempt from the global `dist/` gitignore rule
(see `.gitignore`), so it is committed as a distributable rather than treated as
build output.

## Local verification

```bash
npm install
npm run typecheck
npm test
npm run build
npm run pack:verify
npm run pack:dry-run
```

Inspect `npm pack --dry-run` output. The tarball must include only intended distributable files.
In particular, `ui/dist/**` should be present and `ui/node_modules/**` must be absent.

## ClawHub dry run

```bash
npm i -g clawhub
clawhub login
npm run clawhub:dry-run
```

If the ClawHub CLI contract changes, update this file and `package.json` scripts.

## Publish

```bash
clawhub package publish .
```

Alternative npm path:

```bash
npm publish --access public
```

## Install smoke test

After publishing a private or test release:

```bash
openclaw plugins install clawhub:@your-org/openclaw-artist-runtime
openclaw gateway restart
openclaw plugins doctor
```

Then open the Producer Console route and confirm dry-run mode blocks external side effects.

## Release checklist

- [ ] Version bumped.
- [ ] Changelog updated.
- [ ] Compatibility matrix updated.
- [ ] Config schema migration tested.
- [ ] Marketplace screenshots updated.
- [ ] Security disclosures reviewed.
- [ ] Privacy disclosures reviewed.
- [ ] Gateway auth boundary reviewed against `docs/GATEWAY_AUTH.md`.
- [ ] Connector env / CLI prerequisites verified locally and excluded from package output.
- [ ] Package dry-run clean.
- [ ] ClawHub dry-run clean.
- [ ] Fresh workspace install tested.
