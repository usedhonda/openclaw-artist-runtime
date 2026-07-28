import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate env-based workspace resolution so a test run can never write to the
// operator's live `.local/openclaw/workspace`. Some code paths resolve the
// workspace from `OPENCLAW_LOCAL_WORKSPACE` / `resolveDefaultWorkspaceRoot()`
// rather than from an explicit root — e.g. the notify-review debug handler
// starts the runtime-event ledger and Telegram notifier from env
// (`startRuntimeEventLedgerFromEnv` / `startTelegramNotifierFromEnv`). Without
// this, running `npm test` from the repo appended song_take_completed events to
// the live runtime-events.jsonl (the observed "song-018 zombie" re-fire on every
// suite run). Point env resolution at a throwaway dir instead. An explicitly set
// value is respected so a caller can still target a chosen workspace.
if (!process.env.OPENCLAW_LOCAL_WORKSPACE?.trim()) {
  process.env.OPENCLAW_LOCAL_WORKSPACE = mkdtempSync(join(tmpdir(), "artist-runtime-test-ws-"));
}
