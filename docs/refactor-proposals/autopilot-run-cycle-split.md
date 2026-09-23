# Autopilot runCycle Split Proposal

## Current

`ArtistAutopilotService.runCycle` is the main state-machine tick for the artist runtime. It currently owns lane decisions, producer review release, draft-box ideation, accepted draft promotion, stale cleanup, planning, prompt pack, Suno generation, take selection, completion, and failure handling in one long method.

That density makes the most important contract hard to audit: one tick may move only the allowed lane, Suno generation remains single-lane, producer decisions do not silently fire, and draft ideation may continue without turning into a hidden queue.

## Proposal

Split the state machine by lane and stage, not by arbitrary helper size. Keep `runCycle` as the public orchestration entrypoint, but make it a small dispatcher over explicit stage handlers:

- `prepareCycleContext` reads config, persisted runtime state, current song, draft box state, and worker state once.
- `runHousekeepingLane` handles stale callback audits, queue/draft maintenance, and heartbeat artifacts.
- `runIdeaLane` handles observe/ideate/draft append only. It must never call planning, prompt pack, Suno, or publish code.
- `runCurrentSongLane` handles exactly one current song and must enforce the single-Suno-lane guard.
- `finishCycle` writes the next autopilot state and heartbeat outcome.

Each handler should return a typed outcome such as `no_op`, `state_released`, `draft_appended`, `stage_advanced`, `blocked`, or `failed_closed`. `runCycle` should be the only place that writes the final runtime state after merging those outcomes.

## Impact

This is the highest-risk refactor in the runtime. Any ordering change can recreate old incidents: GO bypass, double Suno fire, stuck currentSongId, or hidden accepted_waiting queues. The split should be done only after characterization tests are dense enough to catch lane bleed.

The likely new files are:

- `src/services/autopilot/cycleContext.ts`
- `src/services/autopilot/ideaLane.ts`
- `src/services/autopilot/currentSongLane.ts`
- `src/services/autopilot/housekeepingLane.ts`
- `src/services/autopilot/cycleOutcome.ts`

Do not move publish guards, Suno import attribution guards, or Telegram callback handlers into the new lane modules. Those remain boundary services.

## Verification Plan

Before code movement, keep the existing characterization tests and add explicit lane contract cases:

- Operator pause and hardStopReason produce no stage work.
- Producer review / take selected release clears currentSongId without launching Suno.
- Draft ideation can run while current song is blocked, but does not promote to planning.
- A building/current song prevents a second Suno generation.
- Prompt pack and Suno generation require a producer action when that gate is enabled.
- Import collision and dryRun isolation tests remain green.

Implementation should proceed in small commits: context extraction, idea lane extraction, current song lane extraction, housekeeping extraction, then dispatcher cleanup. Run R10, take-attribution, draft-box, autopilot ticker, and full test suites after each commit.
