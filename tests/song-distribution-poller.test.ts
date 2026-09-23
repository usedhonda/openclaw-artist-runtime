import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { updateSongState } from "../src/services/artistState";
import { getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { pollSongDistribution, readDistributionDetectionState } from "../src/services/songDistributionPoller";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-distribution-poller-"));
}

function response(body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
}

describe("song distribution poller", () => {
  it("detects UnitedMasters, Spotify, and Apple Music links for scheduled songs", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "where-it-played", { title: "Where It Played", status: "scheduled" });
    const events: unknown[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("unitedmasters")) {
        return response('<a href="https://unitedmasters.com/m/where-it-played">Where It Played</a>');
      }
      if (url.includes("spotify")) {
        return response({ tracks: { items: [{ name: "Where It Played", external_urls: { spotify: "https://open.spotify.com/track/abc" } }] } });
      }
      return response({ results: [{ wrapperType: "track", trackName: "Where It Played", trackViewUrl: "https://music.apple.com/jp/album/where-it-played/123?i=456" }] });
    }) as unknown as typeof fetch;

    const result = await pollSongDistribution(root, {
      fetchImpl,
      spotifyBearerToken: "mock-token",
      unitedMastersProfileUrl: "https://unitedmasters.com/artist/example",
      appleMusicArtistId: "123456789",
      now: new Date("2026-04-29T01:00:00.000Z")
    });
    unsubscribe();

    expect(result.checkedSongs).toBe(1);
    expect(result.detections.map((item) => item.platform).sort()).toEqual(["appleMusic", "spotify", "unitedMasters"]);
    expect(result.detections.find((item) => item.platform === "appleMusic")?.proposal.fields[0]).toMatchObject({
      field: "publicLinksAppleMusic",
      proposedValue: "https://music.apple.com/jp/album/where-it-played/123?i=456"
    });
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "distribution_change_detected", songId: "where-it-played", platform: "spotify" })]));
    const state = await readDistributionDetectionState(root);
    expect(state.detected.spotify.url).toBe("https://open.spotify.com/track/abc");
  });

  it("skips secret-like distribution responses", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "where-it-played", { title: "Where It Played", status: "scheduled" });
    const secretLikeText = `Where It Played ${"TELEGRAM"}_${"BOT"}_${"TOKEN"}=unsafe123`;
    const fetchImpl = vi.fn(async () => response(secretLikeText)) as unknown as typeof fetch;

    const result = await pollSongDistribution(root, { fetchImpl, spotifyBearerToken: "mock-token" });

    expect(result.detections).toHaveLength(0);
    expect(result.warnings.join("\n")).toContain("distribution_response_contains_secret_like_text");
  });

  it("does not re-emit unchanged links on a second poll", async () => {
    const root = workspace();
    await ensureArtistWorkspace(root);
    await updateSongState(root, "where-it-played", { title: "Where It Played", status: "scheduled" });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("spotify")) {
        return response({ tracks: { items: [{ external_urls: { spotify: "https://open.spotify.com/track/abc" } }] } });
      }
      if (url.includes("itunes")) {
        return response({ results: [] });
      }
      return response("Where It Played");
    }) as unknown as typeof fetch;

    await pollSongDistribution(root, { fetchImpl, spotifyBearerToken: "mock-token", now: new Date("2026-04-29T01:00:00.000Z") });
    const second = await pollSongDistribution(root, { fetchImpl, spotifyBearerToken: "mock-token", now: new Date("2026-04-29T02:00:00.000Z") });

    expect(second.detections).toHaveLength(0);
    expect(second.state.detected.spotify.lastCheckedAt).toBe("2026-04-29T02:00:00.000Z");
  });
});
