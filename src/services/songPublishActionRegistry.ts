import { join } from "node:path";
import type { BackupChangeSet } from "./personaBackup.js";
import { ensureBackupChangeSet } from "./personaBackup.js";
import { readSongState, updateSongState } from "./artistState.js";
import { emitRuntimeEvent } from "./runtimeEventBus.js";
import { readResolvedConfig } from "./runtimeConfig.js";
import type { SongState } from "../types.js";

export type SongPublishAction = "song_songbook_write" | "song_skip" | "song_archive" | "song_discard";

export interface SongPublishActionDefinition {
  action: SongPublishAction;
  label: string;
  publishSideEffect: false;
}

export interface SongPublishActionContext {
  root: string;
  songId: string;
  now?: number;
}

export interface SongPublishActionRequest extends SongPublishActionContext {
  action: SongPublishAction;
  actor?: {
    kind: "telegram_callback" | "ui_api";
    chatId?: number;
    userId?: number;
  };
}

export interface SongPublishActionResult {
  action: SongPublishAction;
  status: "applied" | "discarded";
  message: string;
  song?: SongState;
  backups?: BackupChangeSet;
  safety: {
    autopilotDryRun: boolean;
    liveGoArmed: boolean;
  };
}

export function listSongPublishActions(): SongPublishActionDefinition[] {
  return [
    { action: "song_songbook_write", label: "SONGBOOK 反映", publishSideEffect: false },
    { action: "song_skip", label: "後で", publishSideEffect: false },
    { action: "song_archive", label: "採用して保留する", publishSideEffect: false },
    { action: "song_discard", label: "破棄する", publishSideEffect: false }
  ];
}

async function readSafety(root: string): Promise<SongPublishActionResult["safety"]> {
  const config = await readResolvedConfig(root);
  return {
    autopilotDryRun: config.autopilot.dryRun,
    liveGoArmed: config.distribution.liveGoArmed
  };
}

export async function runSongPublishAction(action: SongPublishAction, context: SongPublishActionContext): Promise<SongPublishActionResult> {
  const now = context.now ?? Date.now();
  const safety = await readSafety(context.root);
  const currentSong = await readSongState(context.root, context.songId);
  if (action === "song_skip") {
    emitRuntimeEvent({ type: "song_publish_skipped", songId: context.songId, timestamp: now });
    return {
      action,
      status: "discarded",
      message: "⏸ 後で確認。SONGBOOK は変更していません。",
      song: currentSong,
      safety
    };
  }

  if (action === "song_archive" || action === "song_discard") {
    if (currentSong.status !== "take_selected") {
      throw new Error(`invalid_song_review_transition:${currentSong.status}`);
    }
    if (action === "song_archive") {
      const song = await updateSongState(context.root, context.songId, {
        status: "archived",
        reason: "producer archived selected take without publishing"
      });
      emitRuntimeEvent({ type: "song_archived", songId: context.songId, selectedTakeId: song.selectedTakeId, timestamp: now });
      return {
        action,
        status: "applied",
        message: "採用して保留した。SNS には出していません。",
        song,
        safety
      };
    }
    const song = await updateSongState(context.root, context.songId, {
      status: "discarded",
      reason: "producer discarded selected take and kept brief for reuse",
      clearSelectedTake: true,
      replacePublicLinks: []
    });
    emitRuntimeEvent({ type: "song_discarded", songId: context.songId, previousSelectedTakeId: currentSong.selectedTakeId, timestamp: now });
    return {
      action,
      status: "discarded",
      message: "破棄した。brief は reuse のため残しています。",
      song,
      safety
    };
  }

  if (action !== "song_songbook_write") {
    throw new Error(`unsupported_song_publish_action:${action satisfies never}`);
  }
  if (currentSong.status === "archived" || currentSong.status === "discarded") {
    throw new Error(`song_publish_state_guard:${currentSong.status}`);
  }
  if (currentSong.status !== "take_selected" && currentSong.status !== "social_assets" && currentSong.status !== "scheduled") {
    throw new Error(`invalid_song_publish_transition:${currentSong.status}`);
  }

  const backups = await ensureBackupChangeSet([
    join(context.root, "songs", context.songId, "song.md"),
    join(context.root, "artist", "SONGBOOK.md")
  ], `song-songbook-write-${context.songId}-${now}`);
  const song = await updateSongState(context.root, context.songId, {
    status: "published",
    reason: "song completion confirmed from Telegram"
  });
  emitRuntimeEvent({ type: "song_songbook_written", songId: context.songId, timestamp: now });
  return {
    action,
    status: "applied",
    message: "✓ SONGBOOK 反映済 (status=published)。X 投稿は手動でお願いします。",
    song,
    backups,
    safety
  };
}

export async function handleSongPublishActionRequest(request: SongPublishActionRequest): Promise<SongPublishActionResult> {
  return runSongPublishAction(request.action, {
    root: request.root,
    songId: request.songId,
    now: request.now
  });
}
