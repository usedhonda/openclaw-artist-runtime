# Threat Model

This document summarizes the operator-facing threat model for Artist Runtime.
It is not a replacement for source review; it is the map operators should keep
nearby when deciding where to place the plugin, credentials, runtime artifacts,
and package outputs.

## Scope

Covered surfaces:

- Producer Console and `/plugins/artist-runtime/api/*`
- Prompt Ledger, audit logs, and workspace artifacts
- Suno browser profile and imported Suno audio
- connector credentials for X/Bird and Instagram
- package contents intended for ClawHub/npm distribution

Out of scope:

- OpenClaw Gateway internals
- platform-provider account security outside this plugin
- physical access to the operator machine

## Threats and mitigations

| Threat | CWE / OWASP mapping | Impact | Current mitigation | Covered by | Cross-reference |
| --- | --- | --- | --- | --- | --- |
| Prompt Ledger or audit log leaks sensitive content | CWE-532, OWASP A09 Security Logging and Monitoring Failures | Prompt text, run history, URLs, or operator decisions may leak through logs or package artifacts | Ledger/audit fields are constrained to operational metadata; secrets and raw credential bodies are prohibited | `tests/threat-model-validation.test.ts` | `SECURITY.md`, `docs/PACKAGE_CONTENTS.md` |
| Config override via reachable HTTP surface | CWE-306, OWASP A01 Broken Access Control | An untrusted client that reaches the gateway can toggle config, pause/resume, probe connectors, or trigger dry-run flows | Plugin routes rely on the Gateway plugin boundary; operators must keep the gateway local/trusted or behind authenticated access; invalid config bodies are rejected by schema validation | `tests/threat-model-validation.test.ts`, `tests/config-update-route.test.ts` | `docs/GATEWAY_AUTH.md`, `docs/API_ROUTES.md` |
| Credential exfiltration from env, CLI stores, or browser profiles | CWE-522, OWASP A02 Cryptographic Failures / secret exposure | OAuth tokens, Bird cookie stores, or Suno browser cookies could be exposed if copied into logs, screenshots, PRs, or package contents | Connector docs require local-only handling, environment-only auth inputs, and no credential bodies in ledgers or audit logs | `tests/threat-model-validation.test.ts`, `tests/boundary-grep.test.ts` | `docs/CONNECTOR_AUTH.md`, `SECURITY.md`, `docs/SUNO_BROWSER_DRIVER.md` |
| Workspace artifact leak in distribution package | CWE-200, OWASP A05 Security Misconfiguration | `runtime/suno/*`, `.local/*`, browser profiles, or generated audio could be shipped accidentally | Package contents docs enumerate excluded paths; `.gitignore` excludes runtime/profile/local state; generated assets stay inside song-scoped directories | `tests/threat-model-validation.test.ts`, `scripts/boundary-grep.mjs` | `docs/PACKAGE_CONTENTS.md`, `PRIVACY.md` |
| Suno budget bypass or accidental extra credit spend | CWE-770, OWASP A04 Insecure Design | Live create may consume more Suno credit than intended | `submitMode=live` is gated by a UTC-day budget counter; over-limit attempts fail closed with `budget_exhausted`; operator reset is explicit and confirmed | `tests/threat-model-validation.test.ts`, `tests/suno-budget.test.ts` | `docs/SUNO_BROWSER_DRIVER.md`, `tests/suno-budget.test.ts` |

## Operator checklist

- Keep the Gateway reachable only from trusted operators.
- Keep `.openclaw-browser-profiles/suno/`, `.local/`, env files, and
  `runtime/` off package and PR surfaces.
- Review audit and Prompt Ledger entries for safe fields before sharing.
- Treat `budget_exhausted` as a hard stop until the operator explicitly raises
  the limit, resets the counter, or waits for UTC rollover.
- Use `docs/INCIDENT_RESPONSE.md` when a failure crosses from normal retry into
  operator recovery.
