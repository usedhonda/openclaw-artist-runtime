# v10.30 Callback Watchdog Scope Guards

## Task

Plan v10.30 Phase 3+4: narrow the polling watchdog from callback redispatch to expire/reprompt/audit-only, and block watchdog actors from external publish paths.

## Changes

| Area | What changed | Why |
| --- | --- | --- |
| Watchdog runtime | `runCallbackPollingWatchdogOnce` no longer calls `routeTelegramCallback`. Stale pending callbacks get one plain reprompt message; expired callbacks are marked expired. | Pending means "button displayed", not "button pressed". Redispatch from pending can execute unpressed buttons. |
| Reprompt marker | `markCallbackReprompted` appends an audit-only marker with status unchanged. | Keeps callback ledger forensic and prevents repeated reprompts per callbackId. |
| Song mutex | Watchdog skips pending callbacks when the same `songId` already has an applied/discarded/updated callback. | Prevents same-song action clusters from being surfaced after one action already resolved. |
| Publish guard | Watchdog actors are rejected in callback routing for external publish actions, and X/social publish registries throw `external_publish_actor_guard`. | Recovery actors must never produce external side effects. |
| Config | `OPENCLAW_POLLING_WATCHDOG_REPROMPT_ONCE` defaults on; `OPENCLAW_POLLING_WATCHDOG_MINUTES=0` still disables the watchdog. | Keeps operator kill switch and one-shot reprompt behavior explicit. |
| Tests | Added v10.30 contract tests for no redispatch, one reprompt, song mutex, and no publish. Updated v10.29 watchdog test to expect reprompt-only behavior. | Locks the incident class as a regression boundary. |

## How To Apply

1. Keep `OPENCLAW_POLLING_WATCHDOG_MINUTES=0` during incident recovery.
2. Deploy this commit and restart the gateway/supervisor.
3. Re-enable only after verifying full tests and confirming no `routeTelegramCallback` call remains in the watchdog.
4. For future polling stalls, stale callbacks will not execute actions; they can only emit one plain text reminder.

## Notes

- `src/services/igPublishActionRegistry.ts` and `src/services/tiktokPublishActionRegistry.ts` do not exist in this repo. The shared Instagram/TikTok path is `src/services/socialPublishing.ts`, so the watchdog actor guard was added there.
- Existing `internal_recovery` remains unchanged for non-watchdog manual recovery; external publish actions are still guarded at the watchdog actor layer.
- X tweet deletion remains out of scope because Bird has no delete path.
