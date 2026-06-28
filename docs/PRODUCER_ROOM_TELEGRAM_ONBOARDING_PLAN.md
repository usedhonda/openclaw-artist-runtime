# Producer Room Telegram Onboarding Plan

## Intent

Make the Producer Console a first-run bridge into a Telegram-first producer room.
After setup, the operator should mostly live in Telegram: tap GO/NO, listen, and
only open the Console to glance at status, change settings, or diagnose a hard
stop.

## Product Contract

- First-time operators open the Console because they need setup guidance.
- The Console must lead them to a working Telegram bot and a safe first song
  path, not become the daily command center.
- Once production starts, Telegram is the primary operation surface.
- Console daily use is limited to:
  - `Room`: current status and one next action when blocked.
  - `Songs`: read-only song history and artifacts.
  - `Settings`: steer cadence, budgets, platform authority, and live arms.
  - `Diagnostics`: hidden fallback for developer/operator investigation.
- Healthy state must not show command buttons. It should say that nothing is
  needed and the artist is working.

## Current Evidence

- `ui/src/ProducerRoomApp.tsx` already has the right shell direction:
  `Room / Songs / Setup / Settings / 診断`.
- `RoomHeader` already consumes `autopilot.nextActionSummary` and shows one CTA
  for `paused`, with no fake `/resume` button for `reauth_required`.
- `buildSetupReadiness` already computes a setup checklist:
  `create_artist`, `choose_platforms`, `connect_suno`, `connect_social`,
  `budgets_and_cadence`, `confirm_hard_stops`, `run_dry_run_cycle`,
  `turn_on_autopilot`.
- `docs/OPERATOR_QUICKSTART.md` and `docs/OPERATOR_RUNBOOK.md` describe the
  steps, but they read as documentation rather than an in-product first-run
  journey.
- `docs/LOCAL_RUNTIME_OPS.md` already states the desired responsibility split:
  development happens in repo; operation happens in Telegram.

## Target Journey

### 1. Open Console

The first screen must answer:

- Is this artist ready?
- Is Telegram connected?
- Is Suno ready?
- Is it safe to start?
- What is the one next setup action?

The operator should not need to discover Settings, Setup, docs, and Room in the
right order.

### 2. Finish Setup

The Console shows a single setup ladder:

1. Artist identity/persona.
2. Telegram bot connected and owner allowlist present.
3. Suno login/worker ready.
4. Safety defaults confirmed: dry-run on, hard stops on, publish arms safe.
5. Budget/cadence chosen.
6. Optional platform connection.
7. Dry-run evidence observed.
8. Live autopilot intentionally enabled.

Each item has:

- state: `complete | pending | attention | blocked`;
- one sentence explaining what is missing;
- one action link or button when the Console can do it safely;
- no multi-button command cluster.

### 3. Move to Telegram

When the ladder reaches `readyForAutopilot`, the Console should show a handoff
card:

```text
Telegram が Producer Room です
次からは Telegram の通知で「作る / やめる」「採用 / 破棄」を押すだけ。
Console は状況確認と設定変更に使います。
```

The card should include the current bot handle/status if available and the exact
operator-facing check:

```text
Telegram で /status を送る
```

This is not a request to operate from the repo. It is the first-run validation of
the distributed product's daily surface.

### 4. Normal Running State

Room becomes quiet:

- Artist is: current one-line state.
- Status: healthy / blocked / hard stop / reauth required.
- Why: only when blocked.
- You can: maximum one action.

When healthy, Room says:

```text
Nothing needed — 次の曲を構想中
```

No `Run Cycle Now`, `Generate`, `Manual Create`, or debug action appears in Room.

### 5. Occasional Console Use

- `Songs`: read-only work history and artifacts. Telegram remains the adoption
  surface.
- `Settings`: steer autonomy, budgets, cadence, platform authority, and arms.
- `Diagnostics`: legacy Console, failed notification replay, raw state, and run
  cycle controls. This remains visually secondary and never becomes the default
  producer room.

## Required Design Changes

### Phase 1: First-Run Mode In Room

Add a setup-first state to `ProducerRoomApp`.

When `status.setupReadiness.readyForAutopilot === false`, Room should prioritize
a `FirstRunChecklist` above creative milestones. The checklist should use the
existing `setupReadiness.checklist` response instead of inventing a second
readiness model.

Acceptance:

- A fresh workspace shows setup progress before spawn proposals or song history.
- The checklist highlights exactly one next recommended action.
- The existing `SetupView` remains available but is reached through the current
  checklist item, not by operator guessing.

### Phase 2: Telegram Connection as a First-Class Gate

Add Telegram readiness to setup status. Today the docs describe the three gates,
but the product checklist does not surface them as a distinct product step.

Gate definition:

- `telegram.enabled === true`;
- `TELEGRAM_BOT_TOKEN` is present without exposing its value;
- `TELEGRAM_OWNER_USER_IDS` has at least one owner;
- receive health is healthy or not yet proven but actionable.

Acceptance:

- Fresh install says Telegram is not connected and explains the one missing
  gate without printing secrets.
- Connected Telegram shows the control surface is ready.
- If Telegram receive is stale, setup does not pretend the producer room is
  usable.

### Phase 3: Handoff Card

When setup is complete, replace setup pressure with a handoff card that tells
the operator to use Telegram for daily work.

Acceptance:

- Room no longer pushes setup actions after `readyForAutopilot`.
- The handoff card says Telegram is the primary producer room.
- It lists only Telegram actions that matter: `/status`, notification buttons,
  and listening links.

### Phase 4: Keep Room Signal-Only

Audit Room for command-center relapse.

Allowed in Room:

- Resume button only for `paused` when `nextActionSummary.kind === "paused"`.
- Telegram-mirrored GO/NO cards only when a producer decision is pending.
- Setup checklist actions only before setup is complete.

Not allowed in Room:

- Run cycle.
- Manual create.
- Raw debug replay.
- Multi-action clusters during healthy state.

Acceptance:

- Healthy Room has no primary buttons.
- Blocked Room has at most one primary action.
- Producer decision cards remain mirrored but do not replace Telegram as the
  primary surface.

### Phase 5: Documentation Alignment

Update operator docs so they match the product surface:

- `OPERATOR_QUICKSTART.md`: Console is the setup bridge, Telegram is daily use.
- `PRODUCER_CONSOLE.md`: document Room/Songs/Settings/Diagnostics roles.
- `LOCAL_RUNTIME_OPS.md`: keep the dev-vs-producer split and link the new
  first-run behavior.

Acceptance:

- Docs do not instruct routine use of Run Cycle or debug controls.
- The first-run path ends with Telegram `/status` and button operation.

## Non-Goals

- Do not make a new proposal inbox.
- Do not add a new daily command surface in Console.
- Do not bypass Telegram callbacks with hidden Console-only producer decisions
  except existing emergency/diagnostic paths.
- Do not change R10 publish gates, dry-run behavior, or live arms.
- Do not automate Suno login, CAPTCHA, payment, or account recovery.

## Test Plan

- `producer-room-first-run.test.tsx`
  - fresh setup shows checklist before creative milestones;
  - one next setup action is highlighted;
  - setup complete shows Telegram handoff.
- `producer-room-room-contract.test.tsx`
  - healthy state has no primary action;
  - paused has exactly one Resume action;
  - reauth required has no fake Resume action;
  - producer decision mirrors can render without debug controls.
- `status-setup-readiness.test.ts`
  - setup response includes Telegram readiness without leaking token values;
  - stale receive health prevents "Telegram ready".
- Existing regression:
  - `npm run build:runtime`;
  - `npm run build:ui`;
  - `npm test`;
  - `npm run pack:verify`;
  - R10 publish boundary tests unchanged.

## Definition of Done

- A first-time operator can open the Console and see one guided path to:
  artist setup, Telegram connection, Suno readiness, safe dry-run, and live
  autopilot readiness.
- After setup, the Console visibly steps back and says Telegram is the producer
  room.
- The operator can understand that daily work is Telegram buttons and occasional
  listening, while Console is for status, settings, and diagnostics.
- The design is implemented without adding a second producer workflow.
