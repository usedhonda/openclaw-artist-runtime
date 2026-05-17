# Plan v10.37 complete memory + Plan v10.38 drafting

Date: 2026-05-18

## Task

Consolidate Plan v10.37 completion memory and draft Plan v10.38 SNS publish path without implementation or external side effects.

## Changes

- Added `project_plan_v10_37_complete.md` in project memory.
- Added `project_plan_v10_36_complete.md` as optional consolidation of Phase B-E records.
- Marked `project_plan_v10_37_phase_b_complete.md` as superseded by the integrated v10.37 memory.
- Updated memory index to use consolidated v10.36/v10.37 entries.
- Appended `Plan v10.38: SNS publish path (drafting only、御大 GO 待ち)` to the plan file.

## v10.38 Draft Shape

- `archived` remains not publishable by default.
- Drafted explicit `archived -> publish_review -> social_assets -> scheduled -> published` path.
- Real SNS post requires explicit producer confirmation and keeps R10 / social-real-post-ban guard language.
- Button labels remain plain Japanese action verbs.
- No implementation was started.

## Verification

- Documentation/memory-only change in repo; no runtime code changed.
- Full test and pack verification were run after the drafting work.
