import { join } from "node:path";
import type { SongStatus } from "../types.js";
import { appendAuditLog, createAuditEvent } from "./auditLog.js";
import { readAutopilotRunState, writeAutopilotRunState } from "./autopilotService.js";
import { readSongState, updateSongState } from "./artistState.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { readAllSunoRuns } from "./sunoRuns.js";

// Terminal statuses cannot be abandoned: the song is already finished, published,
// or otherwise closed. Matches the dominant terminal set used across the runtime
// (staleQueueMaintenance / promptPackResurfaceService).
const terminalSongStatuses = new Set<SongStatus>([
  "scheduled",
  "published",
  "archived",
  "discarded",
  "failed"
]);

export type AbandonSongResult =
  | { abandoned: false; statusCode: 404; reason: string }
  | { abandoned: false; statusCode: 409; reason: string }
  | { abandoned: true; statusCode: 200; songId: string; fromStatus: SongStatus; clearedCurrentSong: boolean };

function songAuditPath(root: string, songId: string): string {
  return join(root, "songs", songId, "audit", "actions.jsonl");
}

// Operator lane-clear: mark a non-terminal song without an accepted Suno run as
// failed so the autopilot currentSong lane frees up for a new spawn. Refuses when
// the song is already terminal or when a Suno create has been accepted (real credit
// spent) — that lane must go through normal take handling, not a silent discard.
export async function abandonSong(
  workspaceRoot: string,
  songId: string
): Promise<AbandonSongResult> {
  const song = await readSongState(workspaceRoot, songId).catch(() => undefined);
  if (!song) {
    return { abandoned: false, statusCode: 404, reason: "song_not_found" };
  }
  if (terminalSongStatuses.has(song.status)) {
    return { abandoned: false, statusCode: 409, reason: `song_is_terminal:${song.status}` };
  }

  const runs = await readAllSunoRuns(workspaceRoot, songId).catch(() => []);
  if (runs.some((run) => run.status === "accepted")) {
    return { abandoned: false, statusCode: 409, reason: "song_has_accepted_suno_run" };
  }

  const fromStatus = song.status;
  await updateSongState(workspaceRoot, songId, {
    status: "failed",
    reason: "abandoned_by_operator"
  });

  const state = await readAutopilotRunState(workspaceRoot);
  const clearedCurrentSong = state.currentSongId === songId;
  if (clearedCurrentSong) {
    await writeAutopilotRunState(workspaceRoot, {
      ...state,
      currentSongId: undefined,
      stage: "planning",
      suspendedAt: null,
      blockedReason: undefined,
      lastError: undefined
    });
  }

  await appendAuditLog(
    songAuditPath(workspaceRoot, songId),
    createAuditEvent({
      eventType: "abandon_song",
      actor: "producer",
      details: {
        songId,
        operator: "http",
        reason: "abandoned_by_operator",
        fromStatus,
        clearedCurrentSong
      }
    })
  );

  emitRuntimeEvent({
    type: "song_abandoned",
    songId,
    fromStatus,
    reason: "abandoned_by_operator",
    timestamp: Date.now()
  });

  return { abandoned: true, statusCode: 200, songId, fromStatus, clearedCurrentSong };
}
