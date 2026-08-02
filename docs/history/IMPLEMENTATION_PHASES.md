# Implementation history (archived)

This is a historical record of the original bootstrap plan for this repository. It is
**not** an active instruction set: the phases below are largely complete as of v0.3.0,
and the file list in "Read these files first" refers to a spec layout that no longer
exists. Kept for context on why the codebase is shaped the way it is.

The active project contract is `AGENTS.md`.

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
