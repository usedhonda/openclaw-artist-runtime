import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSongState } from "../src/services/artistState";
import { registerCallbackAction, resolveCallbackAction } from "../src/services/callbackActionRegistry";
import {
  runStaleQueueMaintenance,
  staleQueueCleanupAuditPath,
  suppressRestartStaleError
} from "../src/services/staleQueueMaintenance";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "artist-runtime-stale-queue-"));
}

async function writeSong(root: string, songId: string, status: string, updatedAt: string): Promise<void> {
  const songDir = join(root, "songs", songId);
  await mkdir(songDir, { recursive: true });
  await writeFile(join(songDir, "song.md"), `# ${songId}

<!-- artist-runtime:song-state:start -->
- Song ID: ${songId}
- Status: ${status}
- Created At: ${updatedAt}
- Updated At: ${updatedAt}
- Brief Path:
- Lyrics Version:
- Run Count: 0
- Selected Take:
- Public Links:
  - (none)
- Last Reason:
- Last Import Outcome:
- Degraded Lyrics: false
- Observation Summary:
<!-- artist-runtime:song-state:end -->

## Notes

Pending.
`, "utf8");
}

function readAuditLines(root: string): Promise<Array<Record<string, unknown>>> {
  return readFile(staleQueueCleanupAuditPath(root), "utf8")
    .then((text) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>));
}

describe("stale queue maintenance", () => {
  it("archives stale active queue songs older than the configured TTL and records cleanup audit", async () => {
    const root = await tempRoot();
    await writeSong(root, "old-brief", "brief", "2026-05-01T00:00:00.000Z");
    await writeSong(root, "fresh-brief", "brief", "2026-05-15T00:00:00.000Z");

    const result = await runStaleQueueMaintenance(root, {
      now: new Date("2026-05-16T00:00:00.000Z"),
      ttlHours: 48
    });

    expect(result.cleaned).toEqual([expect.objectContaining({
      songId: "old-brief",
      previousStatus: "brief",
      reason: "stale_queue_cleanup:brief:older_than_48h"
    })]);
    await expect(readSongState(root, "old-brief")).resolves.toMatchObject({
      status: "archived",
      lastReason: "stale_queue_cleanup:brief:older_than_48h"
    });
    await expect(readSongState(root, "fresh-brief")).resolves.toMatchObject({ status: "brief" });
    await expect(readAuditLines(root)).resolves.toContainEqual(expect.objectContaining({
      type: "stale_queue_archived",
      songId: "old-brief"
    }));
  });

  it("detects callback ledger entries that point at missing or terminal songs", async () => {
    const root = await tempRoot();
    await writeSong(root, "archived-song", "archived", "2026-05-15T00:00:00.000Z");
    const now = Date.parse("2026-05-16T00:00:00.000Z");
    const missing = await registerCallbackAction(root, {
      action: "song_spawn_inject",
      songId: "missing-song",
      chatId: 1,
      messageId: 2,
      userId: 3,
      now
    });
    const terminal = await registerCallbackAction(root, {
      action: "prompt_pack_go",
      songId: "archived-song",
      chatId: 1,
      messageId: 3,
      userId: 3,
      now
    });

    const result = await runStaleQueueMaintenance(root, {
      now: new Date("2026-05-16T00:00:00.000Z"),
      ttlHours: 48
    });

    expect(result.inconsistencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        callbackId: missing.callbackId,
        songId: "missing-song",
        reason: "callback_song_missing"
      }),
      expect.objectContaining({
        callbackId: terminal.callbackId,
        songId: "archived-song",
        reason: "pending_callback_terminal_song"
      })
    ]));
    expect(result.resolvedCallbacks).toHaveLength(2);
    await expect(resolveCallbackAction(root, missing.callbackId)).resolves.toMatchObject({
      status: "expired",
      resolveReason: "stale_queue_callback_song_missing"
    });
    await expect(resolveCallbackAction(root, terminal.callbackId)).resolves.toMatchObject({
      status: "expired",
      resolveReason: "stale_queue_pending_callback_terminal_song"
    });
    await expect(readAuditLines(root)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "callback_ledger_inconsistency", callbackId: missing.callbackId }),
      expect.objectContaining({ type: "callback_ledger_inconsistency", callbackId: terminal.callbackId }),
      expect.objectContaining({ type: "callback_ledger_auto_expired", callbackId: missing.callbackId }),
      expect.objectContaining({ type: "callback_ledger_auto_expired", callbackId: terminal.callbackId })
    ]));

    const secondPass = await runStaleQueueMaintenance(root, {
      now: new Date("2026-05-16T00:01:00.000Z"),
      ttlHours: 48
    });
    expect(secondPass.inconsistencies).toHaveLength(0);
    expect(secondPass.resolvedCallbacks).toHaveLength(0);
  });

  it("suppresses restart stale errors when the previous current song is terminal", async () => {
    const root = await tempRoot();
    await writeSong(root, "old-current", "archived", "2026-05-15T00:00:00.000Z");
    await writeSong(root, "next-active", "brief", "2026-05-16T00:00:00.000Z");
    const active = await readSongState(root, "next-active");

    await expect(suppressRestartStaleError(
      root,
      "old-current",
      active,
      "suno_generate_retry:playwright_import_no_urls",
      "playwright_import_no_urls"
    )).resolves.toBe("restart_stale_error_suppressed:old-current:archived");
  });
});
