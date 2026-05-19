# Notify Review Retrigger Endpoint

Date: 2026-05-19

## Task

Add a gated internal endpoint to re-emit `song_take_completed` for a `take_selected` song so the existing Telegram notifier can resend producer-review buttons.

## Implementation

- Added `OPENCLAW_DEBUG_NOTIFY_REVIEW=on` local env gate.
- Added `POST /plugins/artist-runtime/api/songs/:id/notify-review`.
- The route rejects when the gate is off or the song is not `take_selected`.
- The route starts Telegram notifier / runtime-event ledger subscriptions if needed, then emits `song_take_completed` with `actor: "manual_notify_retrigger"`.
- The route writes `notify_review_retriggered` to `runtime/callback-audit.jsonl`.

## Verification

- `npx tsc --noEmit`
- Targeted notify-review / R10 / callback tests
- `npm test`
- `npm run pack:verify`
- `npm run build:runtime`
- Gateway supervisor restart
- `curl -X POST /plugins/artist-runtime/api/songs/song-018/notify-review`

## Live Result

The live curl returned `notified=true`, appended `song_take_completed` to `runtime-events.jsonl`, wrote `notify_review_retriggered` audit, and registered pending `song_archive` / `song_discard` callback actions for Telegram message `476`.
