@AGENTS.md

# Claude Code adapter

`AGENTS.md` above is the project contract and applies to every agent. This file adds
only mechanics specific to Claude Code. If a rule is not Claude-specific, it belongs
in `AGENTS.md`, not here.

## Instruction loading

- `AGENTS.md` reaches Claude Code through the `@AGENTS.md` import on line 1 of this
  file. Claude Code does not read `AGENTS.md` on its own. Do not remove that line.
- `tests/agent-instructions.test.ts` fails if the import is missing.

## Skills and subagents

- Reusable procedures live in `.claude/skills/`. Prefer adding a skill over adding
  another always-loaded section to `AGENTS.md`.
- Subagents do not inherit this conversation or its auto memory. Anything a subagent
  needs must be in its prompt, in `AGENTS.md`, or in `docs/handoff/ACTIVE.md`.
- The `Explore` and `Plan` subagent types skip `CLAUDE.md` entirely. Give them the
  constraints they need explicitly.

## Delegation

When delegating, the delegation message must carry: Task Intent, target files, the
concrete work, what is explicitly out of scope, and the completion condition. Verify
the result against primary evidence — read the diff or re-run the test — before
accepting it.

## Auto memory

Auto memory is not visible to Codex or to subagents. Never let it be the only place a
decision is recorded. Durable decisions go in `docs/handoff/ACTIVE.md` or a commit
message.
