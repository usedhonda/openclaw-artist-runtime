import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listSongStates, readSongState } from "./artistState.js";

export interface SongSummary {
  songId: string;
  title: string;
  status: string;
  updatedAt: string;
}

export interface SongDetail extends SongSummary {
  brief?: string;
  selectedTakeId?: string;
  importedPaths: string[];
}

export async function listRecentSongs(root: string, limit = 10): Promise<SongSummary[]> {
  const songs = await listSongStates(root);
  return songs.slice(0, limit).map((song) => ({
    songId: song.songId,
    title: song.title,
    status: song.status,
    updatedAt: song.updatedAt
  }));
}

export async function getSongDetail(root: string, songId: string): Promise<SongDetail> {
  const song = await readSongState(root, songId);
  const brief = song.briefPath ? await readFile(song.briefPath, "utf8").catch(() => undefined) : undefined;
  return {
    songId: song.songId,
    title: song.title,
    status: song.status,
    updatedAt: song.updatedAt,
    brief: brief?.trim(),
    selectedTakeId: song.selectedTakeId,
    importedPaths: song.lastImportOutcome?.paths ?? song.publicLinks.filter((link) => link.startsWith(join(root, "runtime", "suno")))
  };
}
