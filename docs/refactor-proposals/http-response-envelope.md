# HTTP Response Envelope Proposal

## Current

Route responses currently use several incompatible shapes. Success may be a domain object, `{ dispatched }`, `{ notified }`, `{ replayed }`, or route-specific fields. Errors may be `{ error, statusCode }`, `{ error, message, statusCode }`, `{ errors: [] }`, or domain-shaped validation output.

This is manageable inside a single server file, but it leaks complexity to the Producer Console and any external client. UI code cannot reliably distinguish transport success, domain failure, validation failure, and debug-gate rejection without endpoint-specific branches.

## Proposal

Introduce an HTTP response envelope for new route responses, then migrate existing routes endpoint by endpoint:

```ts
type ApiOk<T> = {
  ok: true;
  data: T;
  meta?: { requestId?: string; generatedAt?: string };
};

type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
  };
};
```

Do not change all routes at once. Add route-local mappers in `responseBuilders.ts` and keep legacy helper names until the UI has migrated.

## Endpoint Mapping

Initial mapping should prioritize operator-facing and mutating endpoints:

- `/api/status` -> `data` is the existing status object.
- `/api/songs` and `/api/songs/:id` -> `data` is the existing list/detail object.
- `/api/callback-actions` -> `data` is the existing callback action response.
- `/api/telegram/callback-dispatch` -> `data` wraps current dispatch result; debug disabled becomes `error.code = "debug_callback_dispatch_disabled"`.
- `/api/songs/:id/notify-review` -> `data` wraps notify result; state mismatch becomes `error.code = "song_not_in_take_selected"`.
- `/api/notify/failed` and `/api/notify/replay/:id` -> `data` wraps existing failed-notify list/replay result.
- `/api/config/overrides` -> validation failures use `error.code = "config_validation_failed"` with `details.errors`.
- `/api/proposals` -> create/update/reject results live under `data`.

Read-only endpoints can keep legacy shapes until UI consumers are switched.

## UI Synchronization Plan

Add a client-side response adapter in `ui/src` that accepts both legacy and enveloped responses during migration. Each API call should move to:

1. `fetchJsonLegacyOrEnvelope<T>()`
2. route-specific type update
3. UI error display from `error.message`
4. removal of legacy parsing only after all routes used by that view are migrated

The Producer Console should not infer success from HTTP 200 alone. It should require `ok: true` once a route has migrated.

## Migration Steps

1. Add envelope types and helpers under routes without changing response bodies.
2. Add UI dual parser with tests.
3. Migrate one low-risk read route and one debug route.
4. Migrate mutating routes in small groups.
5. Remove dual parser only after all documented endpoints emit envelopes.

## Verification Plan

For every migrated endpoint, add a pair of tests: one success envelope and one failure envelope. Run route tests, Producer Console build, UI component tests where available, `npm test`, `npm run build`, and `npm run pack:verify`.
