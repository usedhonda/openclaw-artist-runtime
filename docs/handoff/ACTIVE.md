# Handoff: gateway stability hardening

Task ID: gateway-stability-20260814
Last updated: 2026-08-14 00:18 +08:00 by solo-fallback
Status: in-progress

## Objective
Prevent routine Telegram, diagnostic, and maintenance events from terminating
the live Gateway or dropping producer replies.

## Scope
- Safe, drain-aware Gateway restart through the live configured endpoint
- Accurate supervisor and child-process status
- Telegram transport recovery without whole-Gateway kill by default
- Focused regression coverage, runtime reflection, and live verification

## Explicitly out of scope
- OpenClaw or Node upgrade
- Suno prompt-pack changes
- Config schema, CAPTCHA, publishing, or distribution changes

## Current state
Implementation and runtime reflection are complete. Existing unrelated
prompt-pack worktree changes remain preserved and excluded. The only remaining
completion gate is the planned 24-hour passive observation window.

## Completed
- [x] Root-cause split — evidence: Aug 12-13 had 15 externally signaled supervisor stops and zero non-zero child exits.
- [x] Self-restart denial — evidence: commit `6fd4b59` denies gateway/runtime/mutation tools to the public artist.
- [x] Drain-aware restart — evidence: commit `9345324`; live result `scheduled`, force delta 0.
- [x] Accurate process ownership — evidence: commit `80e36ac`; heartbeat reports supervisor and live Gateway child.
- [x] Component-local Telegram recovery — evidence: commit `00a6adb`; watchdog logged disabled and both installed patches were present.
- [x] Final gates — evidence: typecheck, lint, boundary-grep, 378 files / 1761 tests, and runtime build passed.
- [x] Runtime reflection — evidence: one preflight-safe launchd replacement; health recovered and Telegram connected.
- [x] Live safe restart — evidence: supervisor and child PIDs unchanged, no forced restart, Telegram reconnected.
- [x] Live child uptime refresh — evidence: commit `83a90ff`; focused test 3/3 and heartbeat advanced to 242385ms without restart.

## Files changed
| File | Change |
|---|---|
| `docs/handoff/ACTIVE.md` | Active implementation checkpoint |
| `scripts/openclaw-local-gateway` | Safe restart and authoritative status |
| `scripts/openclaw-gateway-launchd.sh` | Routine restart delegates to safe restart |
| `scripts/openclaw-local-gateway-supervisor` | Child state heartbeat and watchdog opt-in |
| `scripts/openclaw-supervisor-health.mjs` | Persist child process state |
| `scripts/openclaw-local-env.sh` | Whole-Gateway Telegram watchdog default off |
| `scripts/openclaw-local-install.sh` | Reapply Telegram patches after install |
| `scripts/openclaw-local-telegram-*-patch.sh` | Fail closed on upstream seam drift |
| `src/services/supervisorHealth.ts` | Child state heartbeat type |
| `tests/*gateway*`, `tests/supervisor-*` | Focused regression coverage |
| `docs/LOCAL_RUNTIME_OPS.md`, `CHANGELOG.md` | Operator contract |

## Decided (do not relitigate)
| Decision | Reason |
|---|---|
| Keep launchd as the sole supervisor owner | Duplicate lifecycle owners caused restart storms |
| Use OpenClaw safe restart RPC | It defers until active work drains |
| Do not restart on WS 1006 alone | Wrong endpoint diagnostics produced false 1006 failures |
| Keep Telegram whole-process watchdog opt-in only | Transient channel failure must not kill conversations by default |

## Rejected alternatives
| Option | Why rejected |
|---|---|
| `launchctl kickstart -k` for routine restart | Kills supervisor and active producer work immediately |
| OpenClaw upgrade in the same task | Latest stable also requires a Node upgrade and obscures causality |

## Commands run
```
intent-guard start -> active
focused tests -> 14 passed
typecheck / lint / boundary-grep -> pass
npm test -> 378 files, 1761 tests passed
npm run build:runtime -> pass
live safe restart -> scheduled, no PID replacement, Telegram connected
```

## Test results
- Passing: all required gates

## Open questions
- None

## Known risks
- A 24-hour observation window is still required before declaring stable completion.

## Next actions
1. Keep runtime commit `83a90ff` untouched until 2026-08-15 00:18:30 +08:00.
2. Verify zero unexpected supervisor stops, non-zero child exits, and watchdog kills.
3. Archive this handoff and mark the goal complete only if the observation gate passes.

## Completion conditions
- [x] Routine restart drains active work and does not replace the supervisor.
- [x] Status reports the live supervisor and Gateway child correctly.
- [x] Telegram transport failure does not kill the Gateway by default.
- [x] Focused tests and one final full gate pass.
- [x] Runtime is reflected and live verification shows Telegram connected.
- [ ] Twenty-four hours pass with zero unexpected supervisor stops, non-zero child exits, or watchdog kills.

## References
- Design doc: `docs/LOCAL_RUNTIME_OPS.md`
