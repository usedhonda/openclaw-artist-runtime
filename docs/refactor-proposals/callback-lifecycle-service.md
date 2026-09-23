# Callback Lifecycle Service Proposal

## Current

Callback lifecycle rules are split across several modules that all touch `callback-actions.jsonl`.
`callbackActionRegistry.ts` owns category and TTL definitions, `callbackLedgerMaintenance.ts` owns cleanup and consistency checks, and `callbackPollingWatchdog.ts` owns reminder / resurface behavior. Registration ownership is also uneven: some flows register their own actions while others rely on caller-side registration in Telegram handlers.

This is a high-risk seam because producer decisions depend on long-lived buttons, state-compatible resurface, and publish-path exclusions. Past incidents already came from callback expiration semantics drifting away from producer-room state.

## Proposal

Create a single `callbackLifecycleService` that owns callback registration, lifecycle policy lookup, stale/expired classification, resurface eligibility, and consistency audit. The existing registry can remain as the low-level append/read adapter, but all policy decisions should go through the lifecycle service.

The service should expose narrow operations:

- `createProducerDecisionCallback(input)` for producer-room buttons.
- `createOperationalCallback(input)` for short-lived operational buttons.
- `classifyCallback(entry, now, songState)` for active/expired/resurfaceable/terminal.
- `recordCallbackOutcome(input)` for applied/rejected/resurfaced/expired audit records.
- `summarizeLifecycleInconsistencies(root)` for watchdog and status surfaces.

The allowlist for resurface must stay explicit. `x_publish_*`, `daily_voice_publish`, `take_select_regenerate`, and other publish or generation-risk actions must remain outside producer-decision resurface unless a later task explicitly proves the boundary.

## Impact

The change touches every inline Telegram button path and all callback maintenance behavior, so it should not be bundled with unrelated refactors. It will reduce future drift by making TTL, resurface, reminder, and stale cleanup share one state compatibility contract.

Expected consumers:

- `telegramNotifier.ts` for button minting.
- `telegramCallbackHandler.ts` for callback apply/reject resolution.
- `callbackPollingWatchdog.ts` for reminders and resurface nudges.
- `callbackLedgerMaintenance.ts` for stale/inconsistent rows.
- `routes/responseBuilders.ts` for `/api/callback-actions` status.

## Verification Plan

Add lifecycle contract tests before moving production callers:

- Producer-decision callbacks retain 30 day TTL and state-based resurface.
- Publish callbacks are not resurfaceable.
- Terminal song states reject resurface and action application.
- Reminder sent flags remain one-shot.
- Existing callback ledger rows without new optional fields still parse.

Then migrate one caller family at a time: spawn proposals, song archive/discard, prompt pack decisions, and operational callbacks. After each family, run callback registry, callback handler, watchdog, resurface, R10 publish boundary, and full test suites.
