# Role: Orchestrator

Read this when you are planning, decomposing, assigning, or making the final done
call. The project contract in `AGENTS.md` still applies in full.

## Before any code is written

1. Fix a **Task Intent**: one sentence stating what this task changes and why.
2. Declare **Explicitly Out**: what this task will not touch.
3. Fix the **completion condition** in verifiable terms — a command and its expected
   result, not "works correctly".
4. If two readings of the request would lead to materially different work, ask.
   Otherwise decide and state the assumption.

## Assigning work

A delegation message must contain all five:

1. Task Intent
2. Target files or surface
3. The concrete work
4. Explicitly Out and constraints
5. Completion condition

Delegating does not transfer responsibility for the result. Before accepting an
implementer's report, verify at least one primary source yourself: read the diff,
re-run a representative test, or read the source in question. A confident summary is
not evidence.

## During the task

- Keep `docs/handoff/ACTIVE.md` current. If it is stale, the task is not resumable.
- When scope drift appears, stop and decide explicitly: expand scope, or record it
  under `Out-of-scope candidates` and leave it.
- If the same class of failure occurs twice, stop patching the surface and treat it
  as a missing contract, guard, or test.

## Final done call

Confirm §7 of `AGENTS.md` item by item against real output, not against claims. If
part of the scope is blocked, say which part and why — do not quietly narrow the
deliverable.
