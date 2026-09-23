# Phase E Operator Checklist

This checklist covers the operator-owned release actions that stay outside the
automated public-release prep lanes. Keep credentials local and do not paste
tokens, cookies, or private profile paths into issue comments, PRs, screenshots,
or release notes.

## 1. Confirm the public package artifact

```bash
npm run pack:verify && npm run pack:dry-run
```

Rationale: confirms the marketplace tarball excludes internal specs, source
trees, tests, scripts, runtime files, local profiles, and credentials before the
repository visibility changes.

## 2. Review the public release docs

```bash
sed -n '1,220p' README.md && sed -n '1,220p' PUBLISHING.md && sed -n '1,180p' docs/PACKAGE_CONTENTS.md
```

Rationale: lets the operator confirm that the public README, publishing guide,
and package-contents rationale match the intended distribution posture.

## 3. Switch the repository from private to public

```bash
gh repo edit yzhonda/openclaw-artist-runtime --visibility public
```

Rationale: this is an irreversible visibility decision for practical purposes,
so it remains an operator action. Run it only after the package artifact and
public docs have been reviewed.

## 4. Verify repository visibility

```bash
gh repo view yzhonda/openclaw-artist-runtime --json visibility,url
```

Rationale: confirms GitHub reports the expected public state before marketplace
submission or external linking.

## 5. Run the release checklist

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run pack:verify && npm run pack:dry-run
```

Rationale: mirrors the repository gates before ClawHub/npm submission. See
`PUBLISHING.md` for the full release checklist and install smoke-test notes.

## 6. Run the ClawHub dry run

```bash
npm run clawhub:dry-run
```

Rationale: exercises the marketplace publish path without publishing. If the
ClawHub CLI contract has changed, update `PUBLISHING.md` with the new command
and evidence before continuing.

## 7. Submit to the marketplace

```bash
clawhub package publish .
```

Rationale: publishes the package after local gates and the ClawHub dry run pass.
For the npm alternative, use the `npm publish --access public` path documented
in `PUBLISHING.md`.

## 8. Smoke-test a fresh install

```bash
openclaw plugins install clawhub:@yzhonda/openclaw-artist-runtime
openclaw gateway restart
openclaw plugins doctor
```

Rationale: validates that a clean operator install can discover the plugin and
that the setup-safe dry-run boundary remains intact after distribution.

