import { describe, expect, it, vi } from "vitest";
import { findITunesTrack, lookupITunesArtistTracks, normalizeSongTitle } from "../src/services/itunesArtistLookup";

describe("iTunes artist lookup", () => {
  it("fetches configured artist track metadata and matches normalized titles", async () => {
    const fetchImpl = vi.fn(async () => ({
      text: async () => JSON.stringify({
        results: [
          { wrapperType: "artist", artistName: "Configured Artist" },
          { wrapperType: "track", trackName: "Where It Played", trackViewUrl: "https://music.apple.com/jp/song/where-it-played/1", releaseDate: "2026-04-01T00:00:00Z" }
        ]
      })
    })) as unknown as typeof fetch;

    const tracks = await lookupITunesArtistTracks({ artistId: "12345", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("id=12345&entity=song&limit=200&country=jp"));
    expect(tracks).toEqual([{ title: "Where It Played", url: "https://music.apple.com/jp/song/where-it-played/1", releaseDate: "2026-04-01T00:00:00Z" }]);
    expect(findITunesTrack("where it played", tracks)?.url).toContain("music.apple.com");
    expect(normalizeSongTitle("Where-It Played!")).toBe("where it played");
  });

  it("rejects secret-like lookup responses", async () => {
    const fetchImpl = vi.fn(async () => ({ text: async () => "CREDENTIAL=marker123 should not pass" })) as unknown as typeof fetch;
    await expect(lookupITunesArtistTracks({ artistId: "12345", fetchImpl })).rejects.toThrow("itunes_response_contains_secret_like_text");
  });

  it("does not call iTunes without a configured artist id", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(lookupITunesArtistTracks({ fetchImpl })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
