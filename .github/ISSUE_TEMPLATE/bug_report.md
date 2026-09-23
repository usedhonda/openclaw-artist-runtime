---
name: Bug report
about: Report a runtime, connector, autopilot, or Producer Console issue.
title: "[bug] "
labels: bug
assignees: ""
---

> Do not include credentials, OAuth tokens, browser cookies, or session
> headers in this issue. For security-sensitive reports, use GitHub Security
> Advisories on this repository instead.

## What happened?

A clear description of the problem and how it surfaced.

## Expected behaviour

What you expected the plugin / Producer Console / autopilot to do.

## Reproduction

Minimal steps to reproduce. Include:

- Plugin version (`package.json` or marketplace listing)
- OpenClaw gateway version
- Node version (`node --version`)
- Operating system

```text
1.
2.
3.
```

## Logs and ledger entries

Paste relevant excerpts from the Producer Console, route response bodies, or
audit ledgers. Redact tokens and other secrets before pasting.

## Affected surface

- [ ] Producer Console UI
- [ ] HTTP route under `/plugins/artist-runtime/api/...`
- [ ] Autopilot cycle
- [ ] Suno worker / browser driver
- [ ] X / Bird connector
- [ ] Instagram connector
- [ ] TikTok connector
- [ ] Other (please describe)

## Additional context

Anything else that helps reproduction or diagnosis.
