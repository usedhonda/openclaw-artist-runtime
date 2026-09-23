# Contributing

This repository is distribution-first. Contributions must preserve OpenClaw-native plugin boundaries and marketplace safety.

## Development rules

- Keep public side effects behind authority guards.
- Keep ledgers append-only.
- Do not add lifecycle install scripts.
- Do not introduce required dependencies that need native builds or browser downloads at install time.
- Keep connector-specific code behind interfaces.
- Update docs and tests with every capability change.

## Pull request checklist

- [ ] Typecheck passes.
- [ ] Tests pass.
- [ ] Package verification passes.
- [ ] Security/privacy/capability docs updated if needed.
- [ ] No credentials or local runtime files committed.
