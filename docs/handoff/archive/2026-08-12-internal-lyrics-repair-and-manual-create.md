# Handoff: Internal lyric repair and manual Create

Task ID: internal-lyrics-repair-manual-create
Last updated: 2026-08-12 21:52 +08 by solo-fallback
Status: done

## Objective
Keep recoverable lyric validation failures inside the pipeline, then verify that
manual-submit mode fills Suno but leaves Create to the producer.

## Scope
- Bounded internal lyric repair without intermediate producer notifications.
- One live manual-submit song from prompt generation through import and selection.
- Telegram evidence for the actionable handoff and completion.

## Explicitly out of scope
- CAPTCHA automation.
- Automatic Create in manual-submit mode.
- Ledger rewrites.

## Current state
The live song `song-085` completed as `take_selected`. Two real Suno takes were
accepted and imported, two non-empty audio files exist, and Telegram recorded the
manual-submit request, URL-ready update, and completion delivery. Autopilot is not
paused and has no hard stop.

## Completed
- [x] Added bounded internal retries and suppressed intermediate degraded-lyrics notifications — evidence: `9aac4dc`, `e61c52c`.
- [x] Verified the visible Suno form was filled and Create remained user-controlled.
- [x] Verified accepted, imported, selected, and Telegram-completed live state.
- [x] Pushed `main` through `e61c52c`.

## Files changed
| File | Change |
|---|---|
| `src/services/autopilotService.ts` | Bounded correctable lyric retries and silent per-song quarantine. |
| `src/services/lyricsDrafting.ts` | Deferred intermediate degraded notification. |
| `src/services/sunoPromptPackFiles.ts` | Deferred intermediate prompt-pack failure notification. |
| `src/types.ts` | Internal notification-defer option. |
| `tests/prompt-pack-park-and-advance.test.ts` | Existing regression coverage updated for the stable contract. |
| `CHANGELOG.md` | Operator-visible behavior note. |

## Decided (do not relitigate)
| Decision | Reason |
|---|---|
| Recoverable lyric defects stay internal. | The producer needs an action, not validator internals. |
| Exhausted repair quarantines one song without pausing the runtime. | A local content defect must not become a system-wide stop. |
| Manual mode never clicks Create. | The producer requested final parameter control. |

## Rejected alternatives
| Option | Why rejected |
|---|---|
| Ask the producer to repair residual kanji. | Internal content repair belongs to the runtime. |
| Add a new test for every retry step. | Existing focused coverage protects the stabilized behavior. |

## Commands run
```
npm run typecheck -> pass
npx vitest run tests/prompt-pack-park-and-advance.test.ts -> 5/5 pass
npm run build -> pass
npm run lint -> pass
npm test -> 1752/1755 pass; one isolated timing failure passed 9/9, one missing handoff fixed here, one external unpublished dependency remains
```

## Test results
- Passing: lint, typecheck, build, focused retry tests, live manual-submit flow.
- External blocker: distribution smoke cannot install unpublished `playwright-core@1.62.1`.

## Open questions
- None for this task.

## Known risks
- The distribution smoke remains dependent on the package registry publishing the pinned Playwright version.

## Next actions
1. Continue normal autonomous cycles under the persisted submit-mode setting.

## Completion conditions
- [x] Recoverable lyric errors no longer require producer action.
- [x] Manual mode stops before Create.
- [x] Live song accepted, imported, selected, and notified through Telegram.

## References
- Commits: `9aac4dc`, `e61c52c`
