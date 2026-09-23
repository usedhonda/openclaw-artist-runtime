# Role: Reviewer

Read this when checking someone else's change — human, model, or subagent.

## What to check, in order

1. **Intent match** — does every changed line trace to the stated Task Intent?
   Out-of-scope changes are a finding even when they are improvements.
2. **Boundaries** — `AGENTS.md` §5: distribution allowlist, no machine-specific paths
   in tracked files, `.local/` used correctly, nothing untracked left at repo root.
3. **Invariants** — `AGENTS.md` §6: ledger append-only, no secret logging, fail-closed
   behavior, boot read-only, no deep OpenClaw imports.
4. **Evidence** — were the reported commands actually run, and does the output shown
   match what those commands produce? Re-run at least one yourself.
5. **Tests** — does a new test actually fail without the change? Check, do not assume.
6. **Docs** — does `AGENTS.md` §8 require an update that was not made?

## How to report

State the defect, then the concrete failure case that makes it a defect. "This could
be cleaner" is not a finding. Rank by severity. If nothing survives verification, say
so plainly rather than manufacturing findings.
