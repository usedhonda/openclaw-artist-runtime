# Handoff: Telegram conversation repair

Task ID: telegram-conversation-repair
Last updated: 2026-08-13 10:10 +08:00 by solo-fallback
Status: done

## Objective

Restore natural Telegram artist conversations and make Artist Runtime tools
usable on the installed OpenClaw runtime.

## Scope

- Telegram model/auth/runtime selection, artist workspace binding, and plugin
  tool registration compatibility.

## Explicitly out of scope

- Suno Create, credit spend, CAPTCHA automation, social publishing, and
  unrelated refactors.

## Current state

The gateway runs the authenticated Codex harness from the artist workspace, and
all seven Artist Runtime tools register through the current execute contract.

## Completed

- [x] Reproduced the 401 and malformed-tool failures from the exact Telegram run.
- [x] Repaired local auth, workspace, and Codex runtime selection.
- [x] Adapted and rebuilt the plugin tool registrations.
- [x] Verified a Japanese natural-language conversation without side effects.

## Files changed

| File | Change |
|---|---|
| `src/pluginApi.ts` | Current tool factory and execute adapter with trusted workspace binding |
| `src/tools/*.ts` | Tool descriptions for the model-facing contract |
| `tests/prompt-pack-and-registration.test.ts` | One focused seven-tool contract assertion |
| `CHANGELOG.md` | Operator-visible repair note |
| `docs/log/codex/089-telegram-conversation-repair.md` | Work log |

## Decided (do not relitigate)

| Decision | Reason |
|---|---|
| Use the Codex app-server harness | It uses the valid existing subscription login and passed the live conversation proof. |
| Trust runtime `workspaceDir` over model input | Prevents tools from writing into the generic or model-selected workspace. |

## Rejected alternatives

| Option | Why rejected |
|---|---|
| Keep the native OpenClaw OAuth transport | It returned an invalid provider content type in the reproduced environment. |
| Keep the old handler-only tools | OpenClaw 2026.6.1 rejects them as malformed. |

## Open questions

- None.

## Known risks

- The locally installed Codex plugin is runtime state rather than a tracked
  dependency; reinstalling the isolated OpenClaw home requires reinstalling its
  compatible plugin version.

## Completion conditions

- [x] Natural-language reply succeeds through Codex from the artist workspace.
- [x] Gateway loads Artist Runtime, Codex, and Telegram without plugin errors.
- [x] Tool contract has focused regression coverage.
