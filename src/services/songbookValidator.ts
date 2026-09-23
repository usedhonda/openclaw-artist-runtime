import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SongState } from "../types.js";
import { listSongStates } from "./artistState.js";
import { findITunesTrack, type ITunesTrack } from "./itunesArtistLookup.js";

export interface SongbookIssue {
  songId: string;
  title: string;
  issue: "missing_row" | "status_mismatch" | "missing_apple_music";
  expected?: string;
  actual?: string;
  candidateUrl?: string;
}

export interface SongbookValidationResult {
  rows: SongState[];
  issues: SongbookIssue[];
}

function parseSongbookRows(contents: string): Map<string, { status: string; links: string }> {
  const rows = new Map<string, { status: string; links: string }>();
  for (const line of contents.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 7 || !cells[1] || cells[1] === "Song ID" || cells[1].startsWith("---")) {
      continue;
    }
    rows.set(cells[1], { status: cells[3] ?? "", links: cells[6] ?? "" });
  }
  return rows;
}

function hasAppleLink(song: SongState, rowLinks?: string): boolean {
  const joined = [...song.publicLinks, rowLinks ?? ""].join(" ");
  return /music\.apple\.com|itunes\.apple\.com/i.test(joined);
}

export async function validateSongbook(root: string, tracks: ITunesTrack[] = []): Promise<SongbookValidationResult> {
  const [songs, contents] = await Promise.all([
    listSongStates(root),
    readFile(join(root, "artist", "SONGBOOK.md"), "utf8").catch(() => "")
  ]);
  const rows = parseSongbookRows(contents);
  const issues: SongbookIssue[] = [];
  for (const song of songs) {
    const row = rows.get(song.songId);
    if (!row) {
      issues.push({ songId: song.songId, title: song.title, issue: "missing_row" });
    } else if (row.status !== song.status) {
      issues.push({ songId: song.songId, title: song.title, issue: "status_mismatch", expected: song.status, actual: row.status });
    }
    const track = findITunesTrack(song.title, tracks);
    if (track && !hasAppleLink(song, row?.links)) {
      issues.push({ songId: song.songId, title: song.title, issue: "missing_apple_music", candidateUrl: track.url });
    }
  }
  return { rows: songs, issues };
}
