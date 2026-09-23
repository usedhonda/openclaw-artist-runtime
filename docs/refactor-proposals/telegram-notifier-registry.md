# Telegram Notifier Registry Proposal

## Current

`telegramNotifier.ts` still owns many event-type branches: message formatting, resource sections, next-button descriptions, inline keyboard attachment, failed-notify eligibility through event delivery, and spawn digest batching. Phase 6 extracted shared formatting helpers, but the event dispatch structure remains a large switch plus post-send button branches.

The current shape makes it too easy to add a body without buttons, buttons without effect text, or critical events without failed-notify coverage.

## Proposal

Introduce a registry that describes each Telegram-visible runtime event in one place:

```ts
type TelegramRuntimeEventHandler<T extends RuntimeEvent> = {
  type: T["type"];
  format(event: T, context: TelegramFormatContext): Promise<string>;
  actions?: (event: T) => CallbackActionName[];
  attachButtons?: (event: T, messageId: number, context: TelegramButtonContext) => Promise<void>;
  critical?: boolean;
  resources?: boolean;
  digestKey?: (event: T) => string | undefined;
};
```

The registry should not change text output at first. It should wrap the existing formatter functions and button attach functions, with fixture tests proving byte equality for representative events.

Spawn proposal batching can remain a special adapter over the registry: single event uses the event handler, multi-event digest uses a digest handler with row-level actions.

## Impact

This reduces drift between four coupled surfaces:

- Telegram body text.
- "Next button" effect section.
- Inline keyboard button rows.
- Failed-notify / replay critical delivery behavior.

The migration risk is medium because Telegram output is user-visible and callback IDs must be minted with unchanged payload fields. Any registry introduction must keep `registerCallbackAction` payloads byte-compatible in semantic fields, especially for producer-decision actions and publish-path exclusions.

## Verification Plan

Add fixture comparison tests before moving each event family:

- `song_take_completed`
- `song_spawn_proposed`
- `prompt_pack_ready`
- `lyrics_generation_degraded`
- `suno_generate_retry`

For each event, assert body text, button labels, callback action names, and failed-notify critical behavior where relevant. Then migrate handlers in this order: pure body-only events, body + resources, body + buttons, spawn digest. Run Telegram notifier, callback handler, failed-notify, R10 publish boundary, and full test suites after each step.
