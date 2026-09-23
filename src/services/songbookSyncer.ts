import { join } from "node:path";
import { readSongState, updateSongState } from "./artistState.js";
import { findITunesTrack, lookupITunesArtistTracks, type ITunesArtistLookupOptions } from "./itunesArtistLookup.js";
import { ensureBackupChangeSet, type BackupChangeSet } from "./personaBackup.js";
import { validateSongbook, type SongbookValidationResult } from "./songbookValidator.js";

export interface SongbookSyncResult {
  validation: SongbookValidationResult;
  updated: string[];
  backups?: BackupChangeSet;
}

export async function buildSongbookLookup(root: string, options: ITunesArtistLookupOptions = {}): Promise<SongbookValidationResult> {
  return validateSongbook(root, await lookupITunesArtistTracks(options));
}

export async function syncSongbookFromITunes(root: string, options: ITunesArtistLookupOptions = {}): Promise<SongbookSyncResult> {
  const tracks = await lookupITunesArtistTracks(options);
  const before = await validateSongbook(root, tracks);
  const updates = new Set(before.issues.filter((issue) => issue.issue !== "missing_row").map((issue) => issue.songId));
  const paths = [...updates].flatMap((songId) => [join(root, "songs", songId, "song.md"), join(root, "artist", "SONGBOOK.md")]);
  const backups = paths.length > 0 ? await ensureBackupChangeSet(paths, `songbook-sync-${Date.now().toString(36)}`) : undefined;
  const updated: string[] = [];
  for (const songId of updates) {
    const song = await readSongState(root, songId);
    const track = findITunesTrack(song.title, tracks);
    await updateSongState(root, song.songId, {
      appendPublicLinks: track?.url && !song.publicLinks.includes(track.url) ? [track.url] : undefined,
      status: song.status,
      reason: "songbook iTunes sync"
    });
    updated.push(song.songId);
  }
  return { validation: await validateSongbook(root, tracks), updated, backups };
}
