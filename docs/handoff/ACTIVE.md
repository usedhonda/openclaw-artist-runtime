# Handoff: Producer-musician creation loop

## Active goal: producer-musician creation loop (2026-09-09)

The earlier preparation repair did not complete the producer's required workflow.
The active task is to make conversation lead to an interpretable musical revision,
an actual trial, a musician-facing submission, comparison, and a further revision
or producer adoption. Do not equate tool success or form preparation with this goal.

- Production revisions: implement arrangement/title/BPM changes independently of
  lyric changes, preserving prior material and accepted audio.
- Conversation: persist subject, request, constraints, exact trial and pending
  decision; background events must not change the conversation subject.
- History: compare and select a take from its actual song/run, not latest results.
- Reports: exact submitted version, request/delta, playable references and grounded
  listening guidance; operational diagnostics are not the song submission.
- Verification: focused regressions, integrated required gate, Linux reflection,
  actual Telegram trial submission and reply-driven continuation.
- Current deployment access: normal Tailscale SSH now succeeds. The committed
  runtime was rebuilt and reflected through a safe gateway-child replacement.
- Boundaries: manual Create, no public publishing, no CAPTCHA automation, no
  broader tool permissions, no existing ledger-format changes.

Implementation ownership: production-revision worker owns revision persistence;
report worker owns song notifications; history worker owns take selection/material
history; root owns trusted conversation context, tools, run integration and rollout.

Local implementation checkpoint: immutable production revisions, durable trusted
conversation and reply bindings, queued manual preparation, trial import,
historical adoption, and Telegram audio transport are implemented. Reporting now
compares immutable material, keeps original audio, and gives concrete listening
points without claiming audition. Existing normal X/SONGBOOK controls remain.

Verification: the initial implementation passed 411 files / 2,094 tests,
typecheck, lint, runtime/UI builds and boundary/maintainer scans. The subsequent
producer-authorization correction passed its regression tests, typecheck, full
lint and runtime build. Its full suite passed 2,095 tests with one old fixture
failure; that fixture was corrected and all three tests in its file passed,
followed by scoped lint. Unaffected green results were retained.

The first live request exposed a mismatch between native gateway ownership and
the existing Telegram producer allowlist. Commits `f77b938` and `6b4f9b6` correct
the guard and fixtures without granting gateway administrator rights. Both are
deployed on Linux. The repeated actual Telegram request successfully saved a
production revision and prepared Suno. The original adopted take is preserved.
The first prepared run is `suno_mtsymk9p`, production pack 4, prepared at
`2026-09-08T17:45:17Z`. Its title is bilingual, tempo is 148 BPM, and lyrics refer
to the unchanged adopted version. Independent payload readback then found a
contradiction: legacy `BPM 94` survived beside `148 BPM`. No Create was clicked.
The agent closed only its prepared Suno tab; the runtime detected closure and
released its browser. The BPM replacement missed prefix notation. Commit
`e28f404` fixes both notation forms and is deployed. All 411 files / 2,097 tests
passed, along with typecheck, relevant lint and runtime build. The failed run has
no URLs; its pending marker cleared, and a fresh zero-active-work preflight
preceded reflection. Preserve the bad pack as history. The corrected natural
Telegram request produced pack 5, but full payload readback exposed a second
tempo inconsistency: the submitted Intro instruction and YAML vocal-pacing note
still said 92 BPM, while Style and YAML `tempo` said 148. This is a submitted-
payload consistency gap, not another notation-only patch. The canonical lyric
source must remain immutable; rendered production directions must be updated
without touching sung text. Commit `64c6e76` corrects the full rendered contract:
Style, YAML production notes/cues, tempo fields and section directions agree;
canonical source and literal sung tempo references remain unchanged. Its regression
failed before the fix, then all 2,098 tests passed, with typecheck, relevant lint,
and local/Linux runtime builds passing. The commit is deployed; an idle preflight
allowed replacement of only the gateway child, preserving its supervisor.
No Create was clicked for either prepared run. The agent closed the pack-5 Suno
input tab as well; its pending marker cleared before reflection.
Do not report this goal complete.

Next: prepare an exact new revision through
Telegram, and verify that the payload contains only the requested tempo before
operator manual Create. Then verify actual audio import/submission and
reply-driven revision or historical adoption. Never substitute fixtures for live
proof.

## Completed checkpoint: conversational production repair (2026-09-08)

See [the archived completion record](archive/2026-09-08-telegram-production-repair.md).
Linux runtime reflection, real Telegram revision/adoption/preparation, and manual
window persistence are verified. The prepared form is left for the operator;
the existing configured human-submit deadline still applies. Do not restart the
gateway while that pending manual run is active.

The historical parity checkpoint below is retained as prior context, not current
evidence for Telegram enablement or live gateway configuration.

Task ID: linux-host-parity-20260906
Last updated: 2026-09-06 (UTC+9) by orchestrator
Status: in-progress

## Objective
Bring the artist-runtime gateway to parity on a Linux host: the Mac-only
gateway lifecycle is retired, the Suno browser lane and creative pipeline
behave correctly under Linux constraints (containers, no systemd, small
`/dev/shm`), and the operator docs describe how the runtime actually behaves
today rather than the prior Mac-only assumptions.

## Scope
- Linux gateway lifecycle (systemd `--user` units, and the tracked supervisor
  path for hosts without systemd)
- Suno browser ownership (launch vs attach) and human-assist reliability on
  Linux
- Creative pipeline correctness for the structure axis (validator + monotony
  watchdog) introduced by the Dis-dominant creative spine
- Test isolation so live-workspace state cannot leak from the test suite
- Operator-facing docs and this handoff kept in sync with the above

## Explicitly out of scope
- New Instagram/TikTok publish lanes (remain frozen per operator decision)
- Config schema, ledger format, or `package.json.files` changes
- CAPTCHA automation or login-challenge automation

## Current state

Checkpoint 2026-09-07 (whole-system audit on the Linux host):

- Scheduled autopilot ticks ignored config overrides changed after boot (the
  ticker pinned the boot-time snapshot as the tick payload). Fixed in
  `src/services/autopilotTicker.ts` (`scheduledBaseConfig`); the host's `dist`
  is rebuilt and the fix takes effect at the next gateway restart. Until then
  the ticker watcher's safe tick drives cycles.
- The launcher derived in-host HTTP/WS URLs from the tailnet address even when
  the gateway is bound to loopback, so the ticker watcher's safe tick and the
  status connectivity probe always hit a closed port. Fixed in
  `scripts/openclaw-local-env.sh`.
- Out-of-band watcher restarts need the gateway's safe-tick token; without a
  fixed `OPENCLAW_SAFE_TICK_TRIGGER_TOKEN` in the machine-local env the launcher
  generates a fresh random one per shell. A fixed token is now set on the host
  (applies at the next restart). Before that restart, kill the manually started
  watcher so the supervisor's own watcher is the only one.
- Open: the Producer Console is reachable only on loopback on the host. Moving
  to a tailnet bind with token auth needs a gateway restart, which must wait for
  the outstanding human-assist Create window to close (marker
  `runtime/suno/human-assist-pending.json`).
- Open: the plugin's `llm.complete` path did not fall back when the primary
  model returned HTTP 429; the operator temporarily switched the primary model
  by hand. Verify OpenClaw fallback behavior on that path before relying on it.

Several parallel lanes landed fixes toward Linux parity:

- The Mac-only gateway posture is retired; Linux is now a first-class host.
  `scripts/openclaw-local-gateway start|stop|status|health` (the tracked
  supervisor) is the lifecycle owner on a Linux host without systemd
  (containers); `systemd --user` templates under `scripts/linux/` are the
  lifecycle owner on a Linux host that runs systemd. Both are documented in
  `docs/LOCAL_RUNTIME_OPS.md`.
- `SunoBrowserService` owns the Suno browser lifecycle in one of two modes:
  **launch** (default, no `cdpEndpoint` configured) is now Linux-aware
  (`--disable-dev-shm-usage`) and closes its own window when the last holder
  releases it; **attach** (a configured `cdpEndpoint`) never closes the
  externally owned browser and now returns a reused tab to the Suno home
  surface after an accepted submit. See `docs/SUNO_BROWSER_DRIVER.md`.
- Human-assist manual-submit is now single-flight: an outstanding wait blocks
  further creates behind a durable marker, and a closed tab/disconnected
  browser fails the wait fast instead of polling forever.
- The Dis-dominant creative spine's `structure` axis (section order rotation)
  is now validated correctly by the prompt-pack validator (no more false
  section/prehook warnings for non-standard structures) and tracked by the
  monotony watchdog (three-song same-structure streaks now raise a warning).
- A live-workspace leak in the Telegram callback test path is fixed: test
  callbacks no longer fire a background autopilot cycle against the operator's
  real workspace.
- Operator docs (`docs/SUNO_BROWSER_DRIVER.md`, `docs/OPERATOR_RUNBOOK.md`,
  `docs/LOCAL_RUNTIME_OPS.md`, `docs/CONNECTOR_AUTH.md`) and `CHANGELOG.md`
  were updated to describe this behavior, including a recovery runbook for the
  Suno session-expiry / cross-song-rejection failure mode.

## Completed
- [x] Suno browser ownership documented (launch vs attach) — evidence:
  `docs/SUNO_BROWSER_DRIVER.md`, commit `99a570c`.
- [x] Linux shared-memory flag for the plugin-launched browser — evidence:
  commit `7953a27`.
- [x] Human-assist single-flight — evidence: commit `160ab85`, documented in
  `docs/SUNO_BROWSER_DRIVER.md`.
- [x] Structure-aware prompt-pack validation — evidence: commit `b9c3f5f`.
- [x] Three-song structure-streak monotony flag — evidence: commit `b03117a`.
- [x] Live-workspace leak in Telegram callback tests fixed — evidence: commit
  `d4f3270`.
- [x] Linux systemd `--user` templates and healthcheck — evidence: commit
  `7f4d316`.
- [x] Tracked-supervisor-on-Linux-without-systemd path documented — evidence:
  `docs/LOCAL_RUNTIME_OPS.md`.
- [x] Session-expiry recovery runbook written — evidence:
  `docs/OPERATOR_RUNBOOK.md#suno-session-expiry-recovery`.

## Files changed
| File | Change |
|---|---|
| `docs/SUNO_BROWSER_DRIVER.md` | Browser ownership (launch/attach), human-assist single-flight, expired-session failure mode |
| `docs/OPERATOR_RUNBOOK.md` | Suno session-expiry recovery runbook |
| `docs/LOCAL_RUNTIME_OPS.md` | Tracked-supervisor subsection for Linux hosts without systemd |
| `docs/CONNECTOR_AUTH.md` | Linux Firefox-profile-cookie note for Bird/X |
| `CHANGELOG.md` | Entries for the commits above |
| `src/services/sunoBrowserService.ts`, `src/services/sunoBrowserLaunch.ts`, `src/services/cdpHumanAssistDriver.ts`, `src/services/sunoHumanAssist.ts`, `src/services/humanAssistPending.ts` | Browser ownership and single-flight behavior |
| `src/validators/promptPackValidator.ts`, `src/suno-production/durationPlan.ts`, `src/suno-production/generatePromptPack.ts` | Structure-aware validation |
| `src/services/creativeQualityLedger.ts` | Structure-streak monotony flag |
| `scripts/linux/*` | systemd `--user` unit, healthcheck, logrotate templates |

## Decided (do not relitigate)
| Decision | Reason |
|---|---|
| Mac gateway posture is retired; Linux is a first-class host | Operator moved primary operation to a Linux host |
| Tracked supervisor (not systemd) owns the gateway on a Linux host without systemd | Containers have no init/session to run `systemd --user` |
| Suno browser **launch** (not attach) is the default ownership mode | No CDP endpoint is configured by default; attach is reserved for operator-started Chrome |
| Creative spine stays Dis-dominant (本気 Dis default posture) | Producer ruling recorded in project memory; see `project-creative-decision-spine` |

## Rejected alternatives
| Option | Why rejected |
|---|---|
| Keep Mac-only gateway lifecycle docs as the single source of truth | Operator has moved primary operation to Linux; Mac-only docs actively misled operators |
| Auto-solve or bypass Suno CAPTCHA to avoid human-assist entirely | Explicitly prohibited by `AGENTS.md` §6 safety invariants |

## Commands run
```
git log --oneline -- src/services/sunoBrowserService.ts -> confirmed launch/attach history
git show --stat 99a570c / 7953a27 / 160ab85 / b9c3f5f / b03117a / d4f3270 / 7f4d316 -> confirmed change scope per commit
```

## Test results
- Not re-run by this docs-only pass; see each lane's own commit for its test evidence.

## Open questions
- None blocking this docs pass.

## Known risks
- No dedicated operator API route exists yet for attaching feed-verified takes
  after a session-expiry recovery; the runbook step is a manual/developer-
  assisted ledger write (tracked as an open item below).
- DOM take harvest can still cross-attribute takes when the CLI session is
  stale and no feed baseline is available; the fail-closed guard rejects the
  run today but does not prevent the underlying stale-session condition.

## Next actions
1. Phase 4: audio import — resolve the `/api/forbidden` placeholder handling
   so a stale/forbidden CDN URL is distinguished from a genuinely not-ready
   asset, per `docs/SUNO_BROWSER_DRIVER.md`'s import section.
2. Phase 5: re-enable Telegram, autopilot, and social publishing on the Linux
   host under an explicit producer GO (currently retired/paused pending this
   parity work).
3. Add a container-restart hook so the gateway recovers automatically after a
   host/container restart on Linux (no systemd case).
4. Add external monitoring for the Linux gateway beyond the local healthcheck
   timer (`scripts/linux/gateway-healthcheck.sh`).
5. C7 reliability items:
   - Fail-closed DOM take-accept when no feed baseline is available (currently
     only rejects post hoc as cross-song; should refuse to accept from DOM
     alone earlier).
   - Session-expiry precheck before a human-assist run starts, instead of
     discovering the stale session only after a cross-song rejection.
   - Build the missing operator attach-takes API route referenced in the
     session-expiry recovery runbook.

## Completion conditions
- [ ] Linux host runs the full autopilot pipeline (Telegram, Suno, social)
  under an explicit producer GO with no Mac-only assumption remaining in
  tracked docs or code.
- [ ] Phase 4 audio import handles `/api/forbidden` correctly.
- [ ] C7 reliability items above are closed.

## References
- Project memory: `project-creative-decision-spine`, `project-live-runtime-state-location`,
  `project-gateway-launchd-lifecycle`, `project-suno-v55-create-dom`
- Design docs: `docs/SUNO_BROWSER_DRIVER.md`, `docs/LOCAL_RUNTIME_OPS.md`,
  `docs/OPERATOR_RUNBOOK.md`, `docs/CONNECTOR_AUTH.md`
