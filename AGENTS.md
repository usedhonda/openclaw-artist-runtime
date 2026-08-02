# artist-runtime — Project Contract

This file is the **single source of truth** for every coding agent working on this
repository, regardless of which tool or model is running.

- **Codex** reads this file natively.
- **Claude Code** reads it because `CLAUDE.md` starts with `@AGENTS.md`.

Rules here are written by **role** (orchestrator / implementer / reviewer), never by
tool name. Nothing in this repository assumes that a particular tool plans and
another implements.

## 0. Working principles

1. **Think before coding** — separate Fact from Hypothesis. State assumptions and
   trade-offs instead of hiding a guess inside an edit.
2. **Simplicity first** — solve today's problem in the smallest form. No speculative
   abstraction, config knob, or fallback path that nothing asks for.
3. **Surgical changes** — every changed line must trace to the user's request or the
   stated Task Intent. No drive-by reformatting, renaming, or "while I'm here" fixes.
4. **Goal-driven execution** — "it runs" is not done. Done = §7.

## 1. What this project is

A distribution-ready **OpenClaw plugin** (`@yzhonda/openclaw-artist-runtime`,
publishable to ClawHub/npm) that turns an OpenClaw agent into a **public autonomous
musician** on an unattended Mac.

The artist keeps a persistent identity, forms song ideas from its own observations,
writes lyrics and Suno prompt packs, generates tracks through a login-persisted
background Suno browser worker, records every prompt and payload in append-only
ledgers, and publishes to producer-selected platforms (X via Bird; Instagram and
TikTok via official APIs). The human is producer and A&R. The **Producer Console** is
a control tower for setup, audit, pause, and recovery — not the daily workflow.

Two facts constrain every change:

- This is a **public artist runtime**, not a private studio helper. Public side
  effects are real and irreversible.
- This repo is simultaneously a **distributable package** and **one operator's live
  workspace**. See §5.

## 2. Architecture

| Path | Responsibility |
|---|---|
| `src/index.ts`, `src/pluginApi.ts` | Plugin entry; all OpenClaw SDK contact isolated here |
| `src/types.ts` | Central types and enum unions (authority / connection / driver / submit modes) |
| `src/config/` | Schema, defaults, migrations, settings contract |
| `src/services/` | Autopilot, artist state, prompt ledger, audit log, authority guards, Suno drivers |
| `src/connectors/suno/` | `SunoConnector` interface + browser-worker / CLI / human-assist drivers |
| `src/connectors/social/` | `SocialConnector` interface + X (Bird), Instagram, TikTok |
| `src/suno-production/` | Prompt pack generation, style/exclude/YAML builders, duration plan, vendored knowledge |
| `src/hooks/` | `authorityGuard`, `bootstrapArtist` |
| `src/routes/` | Producer Console HTTP API + runtime event stream |
| `src/tools/` | Registered OpenClaw tools (song / suno / social) |
| `src/repositories/`, `src/validators/` | Song repository and state machine, prompt pack validation |
| `ui/` | Producer Console frontend (separate npm project) |
| `vendor/suno-cli/` | Vendored Suno CLI dist |

Boundary rule: the Console frontend calls plugin APIs only. It never talks to Suno,
X, Instagram, or TikTok directly.

## 3. Vocabulary

| Term | Meaning |
|---|---|
| Artist Runtime | This plugin: identity, autonomy, music, publishing, audit |
| Producer Console | Web control tower for setup, settings, audit, recovery |
| Suno Production Pack | `sunomanual`-derived knowledge and prompt-generation engine |
| Suno Browser Worker | Persistent logged-in Suno browser profile driven by the plugin |
| Prompt Ledger | Append-only creation history; mandatory for every work |
| Daily Sharing | Routine public sharing of lyrics, snippets, notes, cards, clips |
| Official Release | Higher-risk action, approval-gated |
| Hard Stop | Condition where autonomous execution must pause and alert |
| Capability Check | Runtime check that a connector can perform an action before enabling it |

## 4. Standard commands

| Purpose | Command |
|---|---|
| Type check | `npm run typecheck` |
| Lint (zero-warning gate) | `npm run lint` |
| Test | `npm test` |
| Test as CI runs it (70% line coverage gate) | `npm run test:coverage` |
| Build | `npm run build` |
| Secret / unsafe-bash scan | `npm run boundary-grep` |
| Maintainer-identity leak scan | `npm run leak-scan` |
| Package verification | `npm run pack:verify` |
| Full local pre-publish chain | `npm run prepublish:local` |

`npm run clawhub:dry-run` requires the external `clawhub` CLI, which is not installed
on every machine. Treat its absence as expected, not as a failure.

**Never run `npm install` / `npm i` at the repository root.** The globally installed
OpenClaw resolves its dependencies from this project's `node_modules`; a root install
prunes them and makes the gateway unbootable. To add a dependency, state the reason
and the recovery plan first.

## 5. Change boundaries

Four layers, and they must not bleed into each other:

1. **Distribution surface** — the `package.json.files` allowlist only. Nothing ships
   unless it is on that list.
2. **Tracked repo files** — must be public-safe: no machine-specific absolute paths
   (`/Users/<name>/...`), no credentials, no personal identity or handles.
3. **`.local/`** — gitignored, machine-specific: env overlay, credentials, private
   runbooks, runtime state, scratch notes.
4. **Temporary files** — the session scratchpad, never the repo root.

Operating rules:

- Never carry a standing local edit on a tracked file. Machine-specific values go in
  `.local/openclaw-local-env.local.sh`; the tracked launcher's `"${VAR:-default}"`
  fallbacks pick them up. See `docs/LOCAL_RUNTIME_OPS.md`.
- Do not leave untracked notes, plans, or instruction files at the repo root.
- Prefer a new operator knob in the manifest `configSchema` over a new env var.
- When adding a local file, confirm `.gitignore` already covers it.

Enforced by `tests/tracked-file-hygiene.test.ts` and `npm run leak-scan`.

**Do not change without explicit approval:** the `package.json.files` allowlist,
`openclaw.plugin.json` `configSchema` shape, append-only ledger formats, `compat`
version pins, or anything under `.github/workflows/`.

## 6. Invariants

**OpenClaw-native.** Do not fork OpenClaw, deep-import its internals (`src/*`,
bundled extension internals, private helpers), replace the agent loop, or run a
separate daemon. Register behavior through plugin surfaces: tools, hooks, services,
HTTP routes. Keep side effects behind registered tools and authority guards.

**Safety.** Do not automate CAPTCHA solving, payment prompts, login challenges, or
lockout recovery. Do not use unofficial Suno reverse-engineered APIs as the default
connector. Fail closed on unclear authority, platform error, quota exhaustion,
CAPTCHA, payment prompt, login challenge, or selector mismatch.

**Secrets.** Never expose platform passwords to the model or store them in plugin
config. Never log API tokens, cookies, passwords, OAuth refresh tokens, session
headers, or browser cookies.

**Rights.** Never generate prompts asking Suno to clone a living artist or an
unlicensed voice.

**Data.** Ledgers are append-only — append new entries, never rewrite existing ones.
A track is not complete unless all creation prompts and payloads are stored. Store
human-readable Markdown and machine-readable JSONL side by side.

**Boot.** Startup is read-only. Do not launch a browser or take side effects at
gateway boot; only an explicit operator action or a create request may do so.

**Code.** Small modules, explicit types. Side-effecting operations are idempotent or
carry explicit run IDs. Public actions record `reason`, `policyDecision`,
`configSnapshot`, `sourceRefs`. Do not fail silently: execute, verify, report.

## 7. Definition of done

A change is done when all of the following hold:

1. `npm run typecheck`, `npm run lint`, and `npm test` pass.
2. The change is reflected where it must take effect (restart / reload / rebuild),
   and that was actually performed.
3. A minimal verification was run and its real output is reported.
4. New behavior has a test; a bug fix has a test that failed before the fix.
5. Changes are committed with a conventional-commit message (English, no AI
   co-author trailer).
6. The report states: what was changed, the commands run, their real output,
   anything not done, and any remaining risk.

Do not report completion for work that is partially done. Say which part is
incomplete and why.

## 8. When documentation must be updated

- Public behavior, config schema, or an operator-visible flow changed → update the
  relevant `docs/*.md` and `CHANGELOG.md`.
- A new operator knob was added → `openclaw.plugin.json` `configSchema` + `uiHints`
  + `docs/RUNTIME_SETTINGS.md`.
- The distribution surface changed → `package.json.files` + `docs/PACKAGE_CONTENTS.md`.
- A contract or spec hotspot changed → update its doc and its guard test in the same
  commit.
- This file's §2, §3, or §4 no longer matches reality → fix it in the same change.

## 9. Roles

Roles are assigned per task, not per tool. Any tool can hold any role, and roles may
change mid-task.

**Orchestrator** — understands the request and fixes scope; decomposes the task;
decides the approach; assigns work; tracks progress and dependencies; reviews the
implementation; confirms test results; records open risks; makes the final done call.
Detail: `docs/agents/ORCHESTRATOR.md`.

**Implementer** — investigates the codebase; implements; refactors; adds and runs
tests; reproduces and fixes defects; updates required docs; reports what was done,
what was decided, and what remains. Detail: `docs/agents/IMPLEMENTER.md`.

**Reviewer** — checks the diff against Task Intent and §5-§7; verifies claims against
primary evidence rather than the implementer's summary. Detail:
`docs/agents/REVIEWER.md`.

Whoever holds a role does that role's job. A single agent may hold all three and must
then satisfy all of their obligations.

## 10. Handoff

Work state must never live only in one model's conversation or private memory.

- The orchestrator writes and maintains `docs/handoff/ACTIVE.md` from
  `docs/handoff/TEMPLATE.md`.
- Update it at each meaningful checkpoint, and always before ending a work session or
  handing over.
- Anyone picking up work reads `docs/handoff/ACTIVE.md` **before** touching code.
- On completion, move it to `docs/handoff/archive/YYYY-MM-DD-<slug>.md`.
- Record verifiable facts, decisions, and reasons — not internal reasoning.
- Decisions listed under `Decided (do not relitigate)` are settled. Reopen one only
  with new evidence, and say what the new evidence is.

## 11. Tool adapters

Only genuinely tool-dependent mechanics belong here.

**Claude Code** loads `CLAUDE.md`, which imports this file. Claude-specific
mechanics — skills, subagents, hooks, settings — live in `CLAUDE.md` and
`.claude/`. Claude Code does not read `AGENTS.md` directly.

**Codex** loads this file natively, merging `~/.codex/AGENTS.md` first and then
repository files from root down to the working directory. The combined size is capped
by `project_doc_max_bytes` (32 KiB by default) — if the global file is large, this
contract can be silently dropped. Verify that §3's vocabulary is visible before
trusting that these rules are in effect. Codex persona and machine settings live in
`.codex/config.toml` (untracked).

## 12. On-demand references

Read these when the task touches them. Do not preload.

| Topic | File |
|---|---|
| Operator setup / daily operation | `docs/OPERATOR_QUICKSTART.md`, `docs/OPERATOR_RUNBOOK.md` |
| HTTP API surface | `docs/API_ROUTES.md` |
| Producer Console | `docs/PRODUCER_CONSOLE.md` |
| Suno browser driver and its failure modes | `docs/SUNO_BROWSER_DRIVER.md` |
| Connector authentication | `docs/CONNECTOR_AUTH.md`, `docs/GATEWAY_AUTH.md` |
| Runtime settings reference | `docs/RUNTIME_SETTINGS.md` |
| Persona canon | `docs/PERSONA_CANONICAL.md` |
| Creative logic / observation pipeline | `docs/CREATIVE_LOGIC.md`, `docs/OBSERVATION_PIPELINE.md` |
| Local vs distribution operations | `docs/LOCAL_RUNTIME_OPS.md` |
| Security posture | `docs/THREAT_MODEL.md`, `docs/INCIDENT_RESPONSE.md`, `SECURITY.md` |
| Publishing | `PUBLISHING.md`, `MARKETPLACE.md`, `docs/PACKAGE_CONTENTS.md` |
| Role detail | `docs/agents/ORCHESTRATOR.md`, `docs/agents/IMPLEMENTER.md`, `docs/agents/REVIEWER.md` |
| Handoff | `docs/handoff/TEMPLATE.md`, `docs/handoff/ACTIVE.md` |
| Historical build phases | `docs/history/IMPLEMENTATION_PHASES.md` |
