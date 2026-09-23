<!--
Thank you for contributing to Artist Runtime. Fill in the sections below
before requesting review. Security-sensitive findings should not be
disclosed in PR descriptions; use GitHub Security Advisories instead.
-->

## Summary

- What changes does this PR introduce?
- Why is the change needed?

## Behaviour change

Describe any user-visible or operator-visible behaviour change. Reference
affected routes, Producer Console panels, autopilot stages, or connector
flows.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run lint` (when ESLint is wired up)
- [ ] `node scripts/boundary-grep.mjs`
- [ ] Manual operator check (describe what you ran in Producer Console / CLI)

## Boundary discipline

- [ ] No real publishing of media without explicit operator GO
- [ ] No bypass of dry-run / live-go arming gates
- [ ] No credentials, cookies, or OAuth tokens written into markdown ledgers,
      audit logs, or test fixtures
- [ ] No new `postinstall` or other implicit lifecycle scripts
- [ ] No personal handles, workspace paths, or release IDs leaked into the
      published `files` tarball (run `npm pack --dry-run` if relevant)

## Linked issues / discussions

- Closes #
- Related #

## Notes for reviewers

Anything that would help review (screenshots, ledger excerpts, follow-up
work tracked elsewhere). Redact tokens before pasting.
