import { secretLikePattern } from "./personaMigrator.js";

export interface ITunesTrack {
  title: string;
  url: string;
  releaseDate?: string;
}

export interface ITunesArtistLookupOptions {
  artistId?: string;
  locale?: string;
  fetchImpl?: typeof fetch;
}

const defaultArtistId = "";
const defaultLocale = "jp";

export function normalizeSongTitle(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export async function lookupITunesArtistTracks(options: ITunesArtistLookupOptions = {}): Promise<ITunesTrack[]> {
  const artistId = options.artistId ?? defaultArtistId;
  if (!artistId) {
    return [];
  }
  const locale = options.locale ?? defaultLocale;
  const response = await (options.fetchImpl ?? fetch)(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(artistId)}&entity=song&limit=200&country=${encodeURIComponent(locale)}`
  );
  const text = await response.text();
  if (secretLikePattern.test(text)) {
    throw new Error("itunes_response_contains_secret_like_text");
  }
  const parsed = JSON.parse(text) as { results?: Array<{ wrapperType?: string; trackName?: string; trackViewUrl?: string; releaseDate?: string }> };
  return (parsed.results ?? [])
    .filter((item) => item.wrapperType === "track" && item.trackName && item.trackViewUrl)
    .map((item) => ({ title: item.trackName ?? "", url: item.trackViewUrl ?? "", releaseDate: item.releaseDate }));
}

export function findITunesTrack(title: string, tracks: ITunesTrack[]): ITunesTrack | undefined {
  const normalized = normalizeSongTitle(title);
  return tracks.find((track) => normalizeSongTitle(track.title) === normalized);
}
