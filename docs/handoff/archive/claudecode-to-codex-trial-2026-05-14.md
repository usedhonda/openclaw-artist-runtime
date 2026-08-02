# ClaudeCode to Codex Trial Handoff — 2026-05-14

This is a temporary handoff document for a short Codex-only operation trial.
It is not a replacement for `AGENTS.md`, `CLAUDE.md`, or the public product docs.

## Scope

- Repository: `artist-runtime`
- Source of handoff knowledge: ClaudeCode memory files, read-only
- This document intentionally excludes credentials, cookies, browser profile content, OAuth tokens, session headers, and local authentication material.
- Do not treat this as a public-marketplace document without review. Some entries are operational memory, not package documentation.

## Read Order For Codex

1. `AGENTS.md`
2. `README.md`
3. `docs/01_ARCHITECTURE.md`
4. `docs/05_AUTOPILOT_SPEC.md`
5. `docs/06_SUNO_WORKER_SPEC.md`
6. `docs/07_SOCIAL_CONNECTORS_SPEC.md`
7. `docs/04_PRODUCER_CONSOLE_SPEC.md`
8. `openclaw.plugin.json`
9. ClaudeCode memory index: `MEMORY.md`
10. Recent operational memories:
    - `project_plan_v10_35_complete.md`
    - `project_plan_v10_34_complete.md`
    - `project_suno_profile_strategy.md`
    - `project_gateway_supervisor.md`
    - `project_plan_v10_30_complete.md`
    - `project_plan_v10_28_c_complete.md`
    - `feedback_public_plugin_plain_labels.md`
    - `feedback_social_real_post_ban.md`
    - `project_harness_commit_guard.md`
    - `project_repo_local_openclaw.md`

## P0 / P1 Operating Rules

- User observation is primary. If the producer says "button was pressed" or "song did not get made", treat that as fact and find the path that explains it.
- Separate facts from hypotheses. Do not patch from "probably".
- Do not propose stopping, deferring, or ending the session unless the user explicitly instructs it or a P0 stop condition is hit.
- Never perform real X/Bird/Instagram/TikTok publish, reply, or media posting without explicit user GO.
- Never automate CAPTCHA, payment prompts, login challenges, or account recovery.
- Never copy secrets, browser cookies, profile data, session headers, OAuth refresh tokens, or `.local/*credentials*` contents into repo docs.
- Do not edit `AGENTS.md` or `CLAUDE.md` during this trial unless a later task explicitly says so.
- Keep OpenClaw bundled/core files read-only unless the task is explicitly assigned to that repo/layer.
- For incidents, freeze the board first: state files, ledgers, callback audit, process status, logs. Restart only with a named hypothesis and expected observation.

## Current Interrupted Work

The interrupted investigation is documented in:

- `docs/log/codex/056-interrupted-work-before-claudecode-handoff-2026-05-14.md`

Summary:

- Producer pressed the Telegram button for `spawn_30aeae`.
- Callback `4skPEBIW3A` was applied with actor `telegram_callback`.
- Current runtime state at freeze:
  - `autopilot-state.stage = "planning"`
  - `currentSongId = "spawn_30aeae"`
  - `suspendedAt = null`
  - `suno-worker.connected = true`
  - `music.suno.driver = "mock"`
  - `autopilot.dryRun = true`
- Song files present:
  - `song.md`
  - `brief.md`
  - `lyrics/lyrics.v1.md`
- Prompt-pack files were missing:
  - `LYRICS.md`
  - `style.md`
  - `exclude.md`
  - `yaml-suno.md`
  - `payload.json`
- Manual `/api/run-cycle` call hung and was killed to freeze the handoff.

Resume this incident by investigating why `/plugins/artist-runtime/api/run-cycle` hangs while `spawn_30aeae` is in planning. Do not start with Suno worker assumptions; the evidence currently points earlier than Suno generation.

## Active Plan / Decision State

### v10.35

Plan v10.35 is complete:

- Plugin-side Telegram `cb` defensive wrapper is implemented.
- Unknown/stale callbacks are blocked before OpenClaw core synthetic-message fallback.
- Audit signature:
  - `result = "expired"`
  - `reason = "unknown_callback_blocked"`
  - `actor = "telegram_callback"`
- Core path limitation: artist-runtime can block synthetic agent messages, but cannot show a JA callback toast through OpenClaw core until core exposes `answerCallbackQuery(text)` to plugin interactive handlers.

### v10.34

Plan v10.34 is complete:

- Default Suno browser worker path is Layer 1:
  - system Google Chrome
  - isolated `.openclaw-browser-profiles/suno`
  - `--password-store=basic`
  - `--disable-blink-features=AutomationControlled`
- `OPENCLAW_SUNO_CHROME_EXECUTABLE` is opt-in fallback.
- `OPENCLAW_SUNO_USE_CDP=on` is emergency fallback.
- Do not copy cookies from the main Chrome profile.
- Treat browser profiles as sensitive local runtime state.

### v10.30

Plan v10.30 is complete and important:

- Watchdog redispatch is forbidden.
- Callback watchdog is expire / one reprompt / audit-only.
- External publish actor guards block watchdog actors at routing and registry layers.
- Reason: v10.29 watchdog redispatched pending actions and caused an unauthorized X post.

## Important Subsystem Knowledge

### Public Artist Runtime

- This is a public autonomous artist plugin, not a private studio helper.
- Created works, prompts, payloads, ledgers, and decisions are first-class artifacts.
- Filesystem-first transparency matters: Telegram and Producer Console should point to files and dashboard surfaces when that helps the producer inspect work.

### Suno Worker

- Current default is dedicated isolated profile, not the producer's main Chrome profile.
- Reauth should use the dedicated Suno login flow and handoff signal, not cookie copying.
- `driver=mock` means no real Suno create should occur.
- Real Suno generation consumes credits and requires explicit plan context/GO.
- Hard stops: login expired, CAPTCHA, payment prompt, selector mismatch, quota exhaustion, UI uncertainty.

### Telegram Producer Room

- Body text may carry artist voice.
- Inline button labels must remain plain and concrete for a public plugin:
  - good: `Suno 生成へ`, `lyrics-suno.md を編集`, `採用`, `保留`
  - bad: overly poetic/voice labels that obscure the action
- Internal telemetry should not leak into Telegram as machine text.
- Unknown/stale callbacks should be blocked deterministically, audited, and not passed to the agent as free text.

### Callback Recovery

- Internal callback dispatch endpoint exists for explicit recovery, gated by debug flag and local access.
- Watchdog must never mutate state by pretending a user pressed a button.
- Pending does not mean "pressed but lost"; it can mean "not pressed".
- For callback incidents, inspect:
  - `runtime/callback-actions.jsonl`
  - `runtime/callback-audit.jsonl`
  - matching Telegram message ID
  - action status and actor

### Producer Console

- v10.28-C added lifecycle visibility:
  - `SongLifecycleTimelineCard`
  - `/timeline`
  - `/api/songs/:id/events`
  - Resources links in Telegram bodies
- Caveat from memory: event ledger source can be sparse; song state still matters.
- v10.32 added single-song page mode. If the producer asks "what happened to this song?", start with the song detail page plus local files.

### Social Connectors

- Real social posting is banned without explicit user GO.
- X/Bird may be configured, but configured is not permission.
- Unauthorized X post in v10.29 is a known incident; preserve this lesson.
- Publish actions need actor guards and audit evidence.

### Package Distribution

- Keep marketplace/package documents clean.
- Package tarball is intentionally narrower than repo:
  - ship `dist/**`, `ui/dist/**`, templates, prompt fragments, schemas, public docs, metadata
  - exclude `src/**`, tests, scripts, internal specs, logs, local runtime/profile paths
- Passing `pack:verify` is necessary but not enough for a behavior claim.

## Recurring Failures And Recovery Pointers

### Gateway / Supervisor

- Repo-local OpenClaw lives under `.local/openclaw/`.
- Use `scripts/openclaw-local-gateway start|stop|status|health|tail`.
- Port memory: status may display confusing values; the practical gateway HTTP port is commonly `43134` from local env/config.
- `openclaw-local-env.sh` sets strict bash options. If sourcing it in scripts, beware `set -e` propagation.
- Do not loop restarts blindly. Capture `gateway.log`, `gateway.supervisor.log`, process list, and lsof first.

### Telegram Polling / Callbacks

- Button press can be applied even if the producer sees no satisfying response.
- Distinguish:
  - callback registered
  - callback delivered
  - callback applied
  - state advanced after callback
- Never infer "button not pressed" from stale state alone.

### AI Provider Not Configured

- Past degrade: `"AI provider ... is not configured"` leaked into song/theme fields.
- Use `isAiNotConfiguredResponse(raw)` style checks before parsing AI output.
- Do not let provider sentinel strings become creative content.

### Voice / Persona

- v10.10 introduced full persona injection and voice contracts.
- v10.14/v10.15 showed that thin voice text still feels broken to the producer.
- Do not patch one Telegram string at a time without checking artifact-generation layers; machine text often leaks from brief/reason/motivation fields.

### Suno Profile

- Profile copy is a dead end.
- Isolated profile + one sign-in + handoff signal is the current route.
- Do not sync or commit `.openclaw-browser-profiles`.

## What To Promote Later Into `AGENTS.md`

Candidates only; do not promote during this trial:

- Pending callback is not proof of user press; watchdog must never redispatch.
- Button labels are control surfaces and must be plain; voice belongs in body text.
- Suno profile copy is a dead end; use isolated profile with `--password-store=basic`.
- Gateway investigation discipline: no restart without hypothesis and expected observation.
- Real social publishing requires explicit GO even if connector auth is valid.
- For "song did not get made", inspect callback ledger, autopilot state, song files, prompt-pack files, and run-cycle behavior in that order.

## Memory-Only Knowledge That Should Become Repo Docs Later

- Suno Layer 1 browser isolation rationale and reauth workflow.
- Callback watchdog incident and final recovery design.
- Telegram callback defensive wrapper behavior and core limitation around `answerCallbackQuery(text)`.
- Filesystem-first transparency policy after v10.28-C.
- Public plugin plain button label policy.
- Gateway supervisor limitations and safe diagnostic workflow.

## Stale Or Reference-Only Knowledge

- v9.24b profile copy attempts are historical evidence, not an implementation path.
- CDP attach is emergency fallback, not default.
- v10.29 watchdog redispatch design is obsolete and dangerous; keep only as incident history.
- Voice-heavy button labels from v10.14 are obsolete after the public plugin plain-label decision.
- Old R6 tarball cap references were removed in v10.6; treat old size-cap logs as historical.

## Trial Rules For Codex

- Before editing: fix the exact Task Intent in one sentence.
- Before runtime operations: capture current state and name the hypothesis.
- Before declaring completion: map requirements to artifacts and verify real evidence.
- If the task involves Telegram buttons, read ledgers first.
- If the task involves Suno, confirm mock/live/driver/dryRun before touching browser worker.
- If the task involves social connectors, assume real publish is forbidden unless the user explicitly says otherwise.
- Commit only safe tracked changes. `docs/log/codex/*.md` may be local-only due harness guard.

## Current Local Caveats

- There are existing untracked recovery/inspection files under `scripts/`, plus `logs/` and `observations/`. They were not created by this handoff and should not be deleted casually.
- The interrupted investigation killed only the hanging `curl` run-cycle request, not the gateway process.
- `AGENTS.md` and `CLAUDE.md` are intentionally unchanged by this handoff.
