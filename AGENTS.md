# AGENTS.md — OpenClaw Artist Runtime Full Distributable

Codex must read this file first.

This repository is both:

1. a **distribution-ready OpenClaw plugin package** for ClawHub/npm, and
2. a **full implementation spec workbench** detailed enough that Codex can start from “read AGENTS.md and make a plan.”

The mission is to build an OpenClaw-native plugin that turns an OpenClaw agent into a **public autonomous musical artist** running on a Mac that the producer usually does **not** watch.

The artist autonomously:

1. Maintains a persistent artist identity and evolving creative state.
2. Forms interests and song ideas from its own observations.
3. Writes lyrics and Suno prompt packs using the bundled Suno Production Pack derived from `sunomanual`.
4. Uses Suno through a login-persisted background browser worker.
5. Saves generated tracks, all prompts, all Suno payloads, run logs, take decisions, social assets, and post URLs.
6. Publishes daily sharing assets to producer-selected platforms: X, Instagram, TikTok.
7. Provides a web Producer Console for setup, connection, policy, audit, pause, and recovery.

The user is the producer, manager, and A&R. The OpenClaw agent is the artist.

---

## Non-negotiable product assumptions

- This is **not** a private studio helper. It is always a **Public Artist Runtime**.
- Producer Console is not the daily workflow. It is the control tower: setup, settings, audit, pause, recovery.
- Normal production mode must be autonomous enough to create music and share it publicly within configured limits.
- A distributed package must install safely: first launch may be dry-run/setup-safe until the operator explicitly connects accounts and enables public side effects.
- The producer chooses which public platforms to enable: X, Instagram, TikTok.
- X uses Bird where available.
- Instagram and TikTok use official platform APIs where possible.
- Suno requires login. The plugin must support a dedicated persistent Suno browser session on the Mac.
- Tampermonkey is not the primary path. Manual copy mode is fallback only.
- A track is not complete unless all creation prompts and payloads are stored.
- Created works and all prompts are first-class artifacts, not transient tool output.

---

## Distribution-first requirement

This package must remain publishable to ClawHub/npm.

Do not implement local-only hacks that make marketplace distribution hard. Every feature must be documented, configurable, testable, and auditable.

Required public-package files:

- `package.json`
- `openclaw.plugin.json`
- `README.md`
- `SECURITY.md`
- `PRIVACY.md`
- `CAPABILITIES.md`
- `MARKETPLACE.md`
- `PUBLISHING.md`
- `CHANGELOG.md`
- `LICENSE`
- `NOTICE.md`

Required package metadata:

- `package.json.openclaw.extensions`
- `package.json.openclaw.compat.pluginApi`
- `package.json.openclaw.compat.minGatewayVersion`
- package-rooted `openclaw.plugin.json`
- manifest `configSchema`
- manifest `uiHints`

---

## OpenClaw-native constraints

Follow OpenClaw design. Avoid unique infrastructure that will break every time OpenClaw changes.

### Do

- Use a native OpenClaw plugin package with `openclaw.plugin.json`.
- Declare user-facing configuration with `configSchema` and `uiHints`.
- Register plugin behavior through OpenClaw plugin surfaces: tools, hooks, services, HTTP routes.
- Use focused SDK imports after verifying the current SDK paths and signatures.
- Keep side effects behind registered tools.
- Enforce autonomous public action policy through hooks/guards before side-effecting tools run.
- Use OpenClaw Cron / Heartbeat / Standing Orders / Tasks where appropriate.
- Keep Producer Console thin: call plugin APIs/tools; do not talk directly to Suno, Instagram, TikTok, or Bird from frontend code.
- Persist creative state in workspace files and machine runtime state in plugin runtime store.
- Use append-only ledgers for prompts, Suno runs, social publishing, and audit events.
- Fail closed on unclear authority, platform error, quota exhaustion, CAPTCHA, payment prompt, login challenge, or selector mismatch.

### Do not

- Do not fork OpenClaw.
- Do not deep-import OpenClaw internals such as `src/*`, bundled extension internals, or private helpers.
- Do not replace the OpenClaw agent loop.
- Do not build a separate daemon unrelated to the OpenClaw Gateway.
- Do not expose platform passwords to the model or store them in plugin config.
- Do not automate CAPTCHA, payment prompts, login challenges, or account lockout recovery.
- Do not use unofficial Suno reverse-engineered APIs as the default connector.
- Do not implement a hidden approval/permission system that bypasses OpenClaw tool/hook behavior.
- Do not let Producer Console frontend directly publish to X/Instagram/TikTok/Suno.
- Do not log API tokens, cookies, passwords, OAuth refresh tokens, session headers, or browser cookies.
- Do not generate prompts that ask Suno to clone a living artist or unlicensed voice.

---

## Architecture boundaries

```text
Core Runtime
  identity, policy, orchestration, workspace bootstrap

Suno Production
  sunomanual knowledge, prompt pack, validators, payload builder, ledger

Suno Browser Worker
  logged-in browser profile, form-fill/create/result import, hard stops

Social Distribution
  connector interface, X/Bird, Instagram, TikTok, asset routing, post ledger

Producer Console
  setup, status, settings, recovery, logs, marketplace-friendly disclosures

Authority Guards
  MusicAuthority, SocialAuthority, RiskClassifier, BudgetLimiter
```

---

## Read these files first

1. `README.md` — repository overview.
2. `SPEC_INDEX.md` — why this package has both distribution docs and detailed Codex specs.
3. `docs/00_PRODUCT_BRIEF.md` — public product summary.
4. `docs/01_ARCHITECTURE.md` — distribution-oriented architecture.
5. `docs/03_OPENCLAW_NATIVE_RULES.md` — compatibility rules.
6. `docs/04_PRODUCER_CONSOLE_SPEC.md` — Producer Console.
7. `docs/05_AUTOPILOT_SPEC.md` — autonomous operation.
8. `docs/06_SUNO_WORKER_SPEC.md` — Suno background worker.
9. `docs/07_SOCIAL_CONNECTORS_SPEC.md` — X/Bird, Instagram, TikTok.
10. `docs/08_PROMPT_LEDGER_SPEC.md` — prompt retention and audit.
11. `docs/12_SUNOMANUAL_INTEGRATION.md` — how `sunomanual` is absorbed.
12. `docs/13_CONNECTOR_SPLIT_PLAN.md` — later package split.
13. `docs/codex-detailed-specs/PRODUCT_SPEC.md` — full product intent.
14. `docs/codex-detailed-specs/ARCHITECTURE.md` — full OpenClaw-native system design.
15. `docs/codex-detailed-specs/IMPLEMENTATION_PLAN.md` — detailed phase plan.
16. `docs/codex-detailed-specs/SUNO_SPEC.md` — detailed Suno spec.
17. `docs/codex-detailed-specs/SOCIAL_CONNECTORS_SPEC.md` — detailed connector spec.
18. `docs/codex-detailed-specs/PROMPT_LEDGER_SPEC.md` — exact retention requirements.
19. `openclaw.plugin.json` — config schema and UI hints.
20. `workspace-template/AGENTS.md` — artist-facing standing orders.

Then produce a plan before editing code.

---

## Implementation order

### Phase 0 — Inspect and adapt

- Inspect the current OpenClaw version and plugin SDK API in the target repository.
- Confirm exact signatures for plugin entry, tool registration, hook registration, service registration, HTTP routes, runtime store, and config access.
- Update stubs in `src/**` to current SDK APIs.
- Run TypeScript/lint checks available in the target repo.

Acceptance:

- Codex reports verified SDK signatures and changed imports before implementing behavior.
- `npm run typecheck` can be made meaningful.

### Phase 1 — Plugin skeleton and config

- Make the plugin load in OpenClaw.
- Validate `openclaw.plugin.json`.
- Register no-op tools and Producer Console routes.
- Make config readable from plugin code.
- Add minimal runtime store helpers.
- Keep package metadata publishable.

Acceptance:

- OpenClaw discovers and enables `artist-runtime`.
- Producer Console route opens.
- `/api/status` returns config, platform statuses, worker states, and dry-run state.
- Package verification passes.

### Phase 2 — Artist workspace and bootstrap

- Copy `workspace-template/**` or generate equivalent files in the selected artist workspace.
- Implement bootstrap hook so the agent receives `ARTIST.md`, `CURRENT_STATE.md`, `SOCIAL_VOICE.md`, Suno profile, and public-autonomy rules.
- Implement `ArtistStateService` for reading/writing state files.

Acceptance:

- A session can answer as the artist, not as a generic assistant.
- Missing workspace files are created safely from templates.
- Producer Console can show Artist Mind.

### Phase 3 — Prompt ledger and song repository

- Implement append-only ledgers.
- Implement song directory creation and status state machine.
- Every tool that creates content must call `PromptLedger.append()` before returning.

Acceptance:

- Creating a song idea produces `songs/<song-id>/brief.md` and `prompts/prompt-ledger.jsonl`.
- Ledger entries include stage, timestamp, input refs, prompt text, output refs, config snapshot/hash, and artist snapshot/hash.
- Existing ledger entries are never overwritten.

### Phase 4 — Suno Production Pack

- Import or vendor user-owned `sunomanual` knowledge into `src/suno-production/knowledge` or `packages/suno-production/knowledge`.
- Implement `createSunoPromptPack()`.
- Generate Style, Exclude, YAML lyrics, sliders, payload JSON, and validation report.
- Ensure Suno payload is saved before any Suno browser action.

Acceptance:

- `artist_suno_create_prompt_pack` creates all required files and ledger entries.
- Validation prevents missing Style/Exclude/YAML/payload.
- Prompt pack can be re-generated with versioned outputs.

### Phase 5 — Suno Browser Worker

- Implement persistent browser profile for Suno.
- First-run path opens Suno and waits for human login.
- After login, background worker can open create page, fill prompt pack, click Create if policy allows, wait/poll for results, and import generated URLs/take info.
- Stop on login challenge, CAPTCHA, payment prompt, UI mismatch, or repeated failures.

Acceptance:

- With a logged-in Suno profile, a song run can create a generation job without the user watching the screen.
- If any hard stop is detected, the worker pauses and reports an actionable alert.
- Prompt Ledger contains the payload hash before Create.

### Phase 6 — Social connectors

- Implement common `SocialConnector` interface.
- X connector wraps Bird.
- Instagram connector wraps official publishing APIs where possible.
- TikTok connector wraps official content posting APIs where possible.
- Implement capability checks per platform.

Acceptance:

- Each enabled platform reports account, capability, quota/rate status, and last action.
- X can publish via Bird when Bird is configured.
- Instagram/TikTok can stage/publish according to capabilities and configured authority.
- Dry-run mode prevents real external calls.

### Phase 7 — Autopilot

- Implement autonomous cycle service:
  `observe -> ideate -> brief -> lyrics -> Suno prompt pack -> Suno generate -> select take -> create social assets -> publish -> log`.
- Use config limits: monthly Suno budget, daily generation cap, per-platform posting caps, quiet windows, hard stops.
- Schedule with OpenClaw-native cron/heartbeat mechanisms where possible; otherwise isolate scheduling in a registered plugin service and make it inspectable in the Console.

Acceptance:

- On a Mac where the screen is not watched, the artist can create and share daily outputs within policy.
- Dashboard shows current cycle stage and last successful verified action.
- All public actions have audit events.

### Phase 8 — Producer Console

- Implement web UI pages:
  - Dashboard
  - Platforms
  - Music / Suno
  - Content Pipeline
  - Songs
  - Prompt Ledger
  - Artist Mind
  - Settings
  - Alerts
  - Marketplace disclosures
- Console must call plugin API only.
- Make all dangerous actions explicit, auditable, and reversible where possible.

Acceptance:

- User can select X/Instagram/TikTok, connect accounts, set authority, set budgets/cadence, pause/reconnect, and inspect ledgers.
- Console never directly calls platform APIs.

### Phase 9 — Marketplace readiness

- Keep `SECURITY.md`, `PRIVACY.md`, `CAPABILITIES.md`, `MARKETPLACE.md`, `PUBLISHING.md` current.
- Add screenshots or text descriptions for Producer Console if ClawHub listing needs them.
- Run dry-run publish commands.
- Confirm `package.json.files` includes only intended public package files.

Acceptance:

- `npm run pack:verify` passes.
- `npm run pack:dry-run` passes.
- `npm run clawhub:dry-run` is documented or stubbed until credentials are available.

---

## Default operating policy

The useful production profile after setup is autonomous:

```json
{
  "artist": { "mode": "public_artist" },
  "autopilot": { "enabled": true, "dryRun": false },
  "music": {
    "engine": "suno",
    "suno": {
      "connectionMode": "background_browser_worker",
      "authority": "auto_create_and_select_take",
      "monthlyGenerationBudget": 50,
      "maxGenerationsPerDay": 4,
      "minMinutesBetweenCreates": 20,
      "promptLogging": "full"
    }
  },
  "distribution": {
    "dailySharing": "auto",
    "officialRelease": "manual_approval"
  },
  "platforms": {
    "x": { "connector": "bird", "authority": "auto_publish" },
    "instagram": { "authority": "auto_publish_visuals" },
    "tiktok": { "authority": "auto_publish_clips" }
  }
}
```

For a distributed package, first install should be setup-safe. It may start with `autopilot.dryRun: true` until the producer explicitly enables real side effects.

Always stop for:

- login expired
- CAPTCHA or anti-bot challenge
- payment or credit purchase prompt
- UI change / selector mismatch
- platform policy uncertainty
- legal/rights uncertainty
- third-party named imitation or voice cloning risk
- repeated failed publishes
- quota exhaustion
- missing connector capability

---

## Key design vocabulary

- **Artist Runtime**: OpenClaw-native plugin that manages public artist identity, autonomy, music, social publishing, and audit.
- **Producer Console**: Web control tower for setup/settings/audit/recovery.
- **Suno Production Pack**: `sunomanual`-derived knowledge and prompt-generation engine.
- **Suno Browser Worker**: Dedicated persistent Suno browser profile used by the plugin after human login.
- **Prompt Ledger**: Append-only creation history. Mandatory for every work.
- **Daily Sharing**: Routine public sharing of lyrics, demo snippets, creation notes, visual cards, and clips.
- **Official Release**: Separate higher-risk action, initially approval-gated.
- **Hard Stop**: Condition where autonomous execution must pause and alert.
- **Capability Check**: Runtime check that a connector can perform the requested action before it is enabled.

---

## Coding rules

- Prefer small modules with explicit types.
- Make every side-effecting operation idempotent or explicitly non-idempotent with run IDs.
- Never mutate prompt ledgers; append new entries.
- Store human-readable Markdown and machine-readable JSONL side by side.
- Include `reason`, `policyDecision`, `configSnapshot`, and `sourceRefs` for public actions.
- Do not silently fail. Use Execute → Verify → Report.
- Use feature flags and capability checks for external platforms.
- Write tests around policy decisions, ledger append behavior, song state transitions, connector failure modes, config schema, and dry-run prevention.
- Keep UI copy in producer/artist language, not internal infrastructure language.
- Keep OpenClaw SDK usage isolated so API changes are easy to patch.

---

## Required tests before declaring a phase done

- Config schema validates defaults and rejects unknown keys.
- Authority guard denies high-risk actions by default.
- Prompt Ledger appends without overwriting existing entries.
- Audit log records all mocked public side effects.
- Dry-run mode prevents all external connector calls.
- Suno worker stops on simulated CAPTCHA/login/payment/UI mismatch.
- Social connectors expose capability checks.
- Producer Console APIs require Gateway/plugin auth as appropriate.
- Package verification confirms required files for ClawHub/npm distribution.

---

## Release discipline

Every release should pass:

```bash
npm run typecheck
npm test
npm run build
npm run pack:verify
npm run pack:dry-run
npm run clawhub:dry-run
```

If `clawhub:dry-run` behavior changes, update `PUBLISHING.md` with the current command and evidence.

---

## First Codex plan must include

1. Current OpenClaw SDK/API verification plan.
2. Any needed corrections to this scaffold.
3. MVP scope for the first PR.
4. Build/test commands for the target repo.
5. Risks and assumptions.
6. A step-by-step implementation sequence.
7. Which external actions remain dry-run in the first PR.
8. How Prompt Ledger will be tested before real Suno/SNS integration.

Do not begin broad rewrites before producing that plan.
