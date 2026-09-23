# Role: Implementer

Read this when you are writing code. The project contract in `AGENTS.md` still
applies in full.

## Before editing

- Read `docs/handoff/ACTIVE.md` if it exists.
- Confirm the Task Intent and Explicitly Out you were given. If they are missing,
  ask for them rather than inventing them.
- Reproduce the problem first when fixing a defect. A fix without a reproduction is a
  guess.

## While editing

- Every changed line must trace to the Task Intent. If you cannot explain a line that
  way, revert it.
- No drive-by changes: no reformatting, no quote-style changes, no added type hints
  or docstrings, no import reordering, no "while I'm here" fixes to nearby code.
- Do not touch files outside the stated scope. If you must, stop and report the file,
  the reason, and the impact before proceeding.
- Add the test with the change, not after.

## Reporting

Report, in this order:

1. What was changed and where
2. Commands run and their real output — unedited, including failures
3. Test results, including anything still failing
4. What was not done, and why
5. Anything you noticed but deliberately left alone

Never summarize away a failure. If a step was skipped, say so.
