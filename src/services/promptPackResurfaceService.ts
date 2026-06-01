import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSongState } from "./artistState.js";
import { readAutopilotRunState } from "./autopilotService.js";
import { readCallbackActionEntries, type CallbackActionEntry } from "./callbackActionRegistry.js";
import { emitRuntimeEvent, type RuntimeEvent } from "./runtimeEventBus.js";
import type { SongState } from "../types.js";

export interface PromptPackResurfaceResult {
  resurfaced: boolean;
  reason: "prompt_pack_ready_resurfaced" | "not_prompt_pack_ready" | "song_not_found" | "no_expired_prompt_pack_callback";
  songId?: string;
  event?: Extract<RuntimeEvent, { type: "prompt_pack_ready" }>;
}

const terminalSongStatuses = new Set(["scheduled", "published", "archived", "discarded", "failed"]);

function firstLyricsExcerpt(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^```/.test(line))
    .slice(0, 5);
  return lines.join("\n") || "(歌詞 excerpt なし)";
}

async function promptPackReadySummary(root: string, song: SongState): Promise<{ lyricsExcerpt: string; mood: string; tempo: string; styleNotes: string }> {
  const lyricsVersion = song.lyricsVersion ?? 1;
  const [lyricsText, moodHint, styleText, briefText] = await Promise.all([
    readFile(join(root, "songs", song.songId, "lyrics", `lyrics.v${lyricsVersion}.md`), "utf8").catch(() => ""),
    readFile(join(root, "songs", song.songId, "mood-hint.txt"), "utf8").catch(() => ""),
    readFile(join(root, "songs", song.songId, "suno", "style.md"), "utf8").catch(() => ""),
    readFile(join(root, "songs", song.songId, "brief.md"), "utf8").catch(() => "")
  ]);
  const source = `${styleText}\n${briefText}`;
  return {
    lyricsExcerpt: firstLyricsExcerpt(lyricsText),
    mood: moodHint.trim() || briefText.match(/^- Mood:\s*(.+)$/m)?.[1]?.trim() || "unspecified",
    tempo: source.match(/\b\d{2,3}\s*BPM\b/i)?.[0] ?? "unspecified",
    styleNotes: styleText.replace(/\s+/g, " ").trim().slice(0, 180) || briefText.match(/^- Style notes:\s*(.+)$/m)?.[1]?.trim() || "unspecified"
  };
}

function isExpiredPromptPackGo(entry: CallbackActionEntry, songId: string, now: number): boolean {
  return entry.songId === songId
    && entry.action === "prompt_pack_go"
    && (entry.status === "expired" || (entry.status === "pending" && entry.expiresAt <= now));
}

async function hasExpiredPromptPackGo(root: string, songId: string, now: number): Promise<boolean> {
  return (await readCallbackActionEntries(root)).some((entry) => isExpiredPromptPackGo(entry, songId, now));
}

export async function resurfacePromptPackReady(
  root: string,
  options: { songId?: string; now?: number; requireExpiredGo?: boolean } = {}
): Promise<PromptPackResurfaceResult> {
  const now = options.now ?? Date.now();
  const state = await readAutopilotRunState(root);
  const songId = options.songId ?? state.currentSongId;
  if (!songId || state.suspendedAt !== "prompt_pack_ready" || (state.currentSongId && state.currentSongId !== songId)) {
    return { resurfaced: false, reason: "not_prompt_pack_ready", songId };
  }
  if (options.requireExpiredGo && !await hasExpiredPromptPackGo(root, songId, now)) {
    return { resurfaced: false, reason: "no_expired_prompt_pack_callback", songId };
  }

  const song = await readSongState(root, songId).catch(() => undefined);
  if (!song || terminalSongStatuses.has(song.status)) {
    return { resurfaced: false, reason: "song_not_found", songId };
  }

  const summary = await promptPackReadySummary(root, song);
  const event: Extract<RuntimeEvent, { type: "prompt_pack_ready" }> = {
    type: "prompt_pack_ready",
    songId: song.songId,
    title: song.title,
    lyricsExcerpt: summary.lyricsExcerpt,
    mood: summary.mood,
    tempo: summary.tempo,
    styleNotes: summary.styleNotes,
    timestamp: now
  };
  emitRuntimeEvent(event);
  return { resurfaced: true, reason: "prompt_pack_ready_resurfaced", songId, event };
}
