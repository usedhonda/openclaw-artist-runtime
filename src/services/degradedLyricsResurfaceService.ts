import { readSongState } from "./artistState.js";
import { readAutopilotRunState } from "./autopilotService.js";
import { emitRuntimeEvent, type RuntimeEvent } from "./runtimeEventBus.js";
import type { SongStatus } from "../types.js";

export interface DegradedLyricsResurfaceResult {
  resurfaced: boolean;
  reason: "lyrics_generation_degraded_resurfaced" | "not_degraded_lyrics" | "song_not_found";
  songId?: string;
  event?: Extract<RuntimeEvent, { type: "lyrics_generation_degraded" }>;
}

const terminalSongStatuses = new Set<SongStatus>(["scheduled", "published", "archived", "discarded", "failed"]);

function repairNotesFromReason(reason?: string): string[] {
  const value = reason?.trim();
  if (!value) return ["歌詞生成に失敗して止まっている"];
  const detail = value.startsWith("lyrics_generation_degraded:")
    ? value.slice("lyrics_generation_degraded:".length).trim()
    : value;
  return detail
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export async function resurfaceDegradedLyrics(
  root: string,
  options: { songId?: string; now?: number } = {}
): Promise<DegradedLyricsResurfaceResult> {
  const now = options.now ?? Date.now();
  const state = await readAutopilotRunState(root);
  const songId = options.songId ?? state.currentSongId;
  if (!songId) {
    return { resurfaced: false, reason: "song_not_found" };
  }

  const song = await readSongState(root, songId).catch(() => undefined);
  if (!song || terminalSongStatuses.has(song.status)) {
    return { resurfaced: false, reason: "song_not_found", songId };
  }
  if (!song.degradedLyrics) {
    return { resurfaced: false, reason: "not_degraded_lyrics", songId };
  }

  const repairNotes = repairNotesFromReason(song.lastReason);
  const detail = repairNotes.join(" | ") || "歌詞生成に失敗して止まっている";
  const reason = song.lastReason?.trim() || `lyrics_generation_degraded: ${detail}`;
  const event: Extract<RuntimeEvent, { type: "lyrics_generation_degraded" }> = {
    type: "lyrics_generation_degraded",
    songId: song.songId,
    reason,
    detail,
    repairNotes,
    timestamp: now
  };
  emitRuntimeEvent(event);
  return { resurfaced: true, reason: "lyrics_generation_degraded_resurfaced", songId: song.songId, event };
}
