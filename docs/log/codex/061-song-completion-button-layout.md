# Song Completion Button Layout

Date: 2026-05-20

## Task

Fix Telegram `song_take_completed` inline buttons so producer review labels are readable after v10.37 added archive/discard actions.

## Change

- Kept all button labels and callback data unchanged.
- Changed `inline_keyboard` from one row of five buttons to multiple rows:
  - Row 1: `採用して保留する` / `破棄する (brief 残す)`
  - Row 2: `SONGBOOK.md に追記` / `保留`
  - Row 3: `X 草案を作る` when enabled

## Verification

- Tests assert row length is at most two and callback actions remain unchanged.
- Runtime build and gateway restart were run after the change.
