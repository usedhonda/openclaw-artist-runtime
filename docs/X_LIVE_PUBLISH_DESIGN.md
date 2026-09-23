# X Live Publish Gate Design (Skeleton)

This document captures the staged release design for X (Twitter) live publishing. The implementation in `src/connectors/social/xLiveGateState.ts` is a **skeleton only** that returns `idle` for every input; real path activation is gated on explicit operator GO and is intentionally deferred to a future round.

## State Machine

```
idle
  → armedGlobal       (distribution.enabled && distribution.liveGoArmed)
    → armedPlatform   (platforms.x.enabled && platforms.x.liveGoArmed)
      → armedExplicitGo (per-call explicit go signal)
        → liveAttempt (publish/reply path entered)
          → success | failed
```

## Transition Conditions

| From | To | Required Signals |
|---|---|---|
| `idle` | `armedGlobal` | `DistributionConfig.enabled === true` AND `DistributionConfig.liveGoArmed === true` |
| `armedGlobal` | `armedPlatform` | `XPlatformConfig.enabled === true` AND `XPlatformConfig.liveGoArmed === true` |
| `armedPlatform` | `armedExplicitGo` | per-call explicit go (operator-confirmed payload, **not yet wired**) |
| `armedExplicitGo` | `liveAttempt` | bird CLI probe green AND fresh authStatus |
| `liveAttempt` | `success`/`failed` | bird tweet result |

## Operator GO Requirements (Deferred)

Live activation requires all of the following, none of which are reachable from current code:

1. Operator updates `config-overrides.json` with `distribution.liveGoArmed=true` and `distribution.platforms.x.liveGoArmed=true`.
2. Operator confirms bird CLI probe is green via Producer Console.
3. Operator triggers an explicit go signal per call (mechanism reserved for the next round).
4. Operator reviews the dry-run reply audit ledger and confirms the resolved target.

`evaluateGate()` returns `idle` regardless of inputs to enforce fail-closed behavior until the explicit-go wiring is added in a future round.

## Why Skeleton Only

Per the social-real-post ban (`memory/feedback_social_real_post_ban.md`), X real publish requires explicit operator authorization. This round documents the contract and reserves the enum names so subsequent rounds can plug in the real transitions without renaming public types.
