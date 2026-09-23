# Producer Console

This document captures operator-facing console behavior that is specific to the
distributed plugin package.

## Observability panel

Round 68 groups the previously separate status cards into one Producer Console
observability panel:

- **Distribution** shows the latest social publish / reply ledger events.
- **Platforms** shows the 7-day platform uptime and success-rate sparklines.
- **Budget** shows the Suno credit budget and reset surface already backed by
  the `/api/suno/budget/reset` route.
- **Suno** shows the browser-worker state, last create/import outcome, and
  imported asset paths.

The cards are reused inside tabs; the panel does not add any publish button,
Suno submit path, TikTok capability, or frontend direct connector call.

## Status export

Operators can export a JSON snapshot from the observability panel. The export
button calls:

```text
GET /plugins/artist-runtime/api/status/export?window=7d
GET /plugins/artist-runtime/api/status/export?window=30d
GET /plugins/artist-runtime/api/status/export?window=all
```

The response shape is:

```json
{
  "window": "7d",
  "exportedAt": "2026-04-24T00:00:00.000Z",
  "status": {},
  "ledger": {
    "events": [],
    "platformStats": {}
  }
}
```

Use the 7-day export for routine support tickets, 30-day export for recurring
operations issues, and `all` only when archive history is needed. The `all`
window includes `social-publish.archive.jsonl` entries created by the social
publish ledger rotation path.
