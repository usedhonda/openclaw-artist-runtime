# Handoff: gateway stability hardening

Task ID: gateway-stability-20260814
Last updated: 2026-08-16 13:02 +07:00 by solo-fallback
Status: monitoring after corrective fix

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
The first 24-hour observation failed with 173 non-zero Gateway child exits. The
verified trigger was Telegram startup transport exhausting DNS/IPv4 attempts and
then using an unreachable pinned fallback address. Commit `c548f83` removes only
that pinned attempt and also repairs the Suno cooldown idempotent hold that made
Telegram report progress without actually advancing the song. Runtime reflection
and a real Telegram/Suno recovery pass are complete. Existing unrelated prompt-pack
worktree changes remain preserved and excluded. A fresh 24-hour passive observation
started at 2026-08-16T06:01:08Z.

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
- [x] Failed observation diagnosed — evidence: 173 non-zero child exits, each recent startup crash ending on Telegram `ENETUNREACH` after the pinned-IP fallback.
- [x] Startup crash fix — evidence: commit `c548f83`; installed dist has no pinned fallback attempt, Telegram reached `running=true, connected=true`, and no unexpected post-fix exit occurred.
- [x] Conversation progress fix — evidence: expired non-hard-stop create cooldown now re-drives instead of idempotent-holding.
- [x] Live recovery — evidence: real run advanced `blocked_authority` -> `accepted` -> `imported` with two real URLs and two local files; Telegram recorded `suno_human_assist_requested`, `suno_take_url_ready`, and `song_take_completed`, each with a message ID.

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
| `src/services/autopilotService.ts`, `tests/autopilot-idempotent-hold-stall.test.ts` | Re-drive expired create cooldown holds |
| `scripts/openclaw-local-telegram-pollfatal-patch.sh` | Disable the crashing pinned-IP fallback while retaining retry |

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
focused tests -> 20 passed (prior 14 plus current 6)
typecheck / lint / boundary-grep -> pass
npm test -> 378 files, 1761 tests passed
npm run build:runtime -> pass
live reflection -> child-only graceful reload, supervisor retained, Telegram connected
live recovery -> accepted/imported real run, 2 paths, Telegram completion receipt
```

## Test results
- Passing: all required gates

## Open questions
- None

## Known risks
- The corrective 24-hour observation ends at 2026-08-17T06:01:08Z. Its initial sample is clean; stability is not yet declared.

## Next actions
1. Keep runtime commit `c548f83` and the installed Telegram patch untouched until 2026-08-17T06:01:08Z.
2. Verify zero unexpected supervisor stops, non-zero child exits, and watchdog kills in the new observer state.
3. Archive this handoff only if the corrective observation passes.

## Completion conditions
- [x] Routine restart drains active work and does not replace the supervisor.
- [x] Status reports the live supervisor and Gateway child correctly.
- [x] Telegram transport failure does not kill the Gateway by default.
- [x] Focused tests and one final full gate pass.
- [x] Runtime is reflected and live verification shows Telegram connected.
- [ ] Corrective twenty-four hours pass with zero unexpected supervisor stops, non-zero child exits, or watchdog kills.

## References
- Design doc: `docs/LOCAL_RUNTIME_OPS.md`
