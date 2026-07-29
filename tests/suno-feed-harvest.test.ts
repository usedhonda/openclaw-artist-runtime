import { describe, expect, it } from "vitest";
import {
  extractFeedClips,
  fetchSunoFeedClips,
  feedClipSongUrl,
  selectFreshFeedTakeUrls,
  type SunoFeedClip
} from "../src/services/sunoFeedHarvest.js";

const SUBMIT_MS = Date.parse("2026-07-29T17:17:09.000Z");
const AFTER = "2026-07-29T17:17:18.000Z"; // 9s after submit (the on-device timing)
const BEFORE = "2026-07-29T17:00:00.000Z";

function clip(partial: SunoFeedClip): SunoFeedClip {
  return partial;
}

describe("selectFreshFeedTakeUrls", () => {
  it("selects the two fresh title-scoped clips created after submit", () => {
    const clips = [
      clip({ id: "3faec32d", title: "Cold Banquet", created_at: AFTER, status: "streaming" }),
      clip({ id: "0b99a8e3", title: "Cold Banquet", created_at: AFTER, status: "streaming" })
    ];
    const result = selectFreshFeedTakeUrls({
      clips,
      title: "Cold Banquet",
      sinceMs: SUBMIT_MS,
      baselineIds: new Set()
    });
    expect(result.overCount).toBe(false);
    expect(result.urls).toEqual([
      feedClipSongUrl("3faec32d"),
      feedClipSongUrl("0b99a8e3")
    ]);
  });

  it("excludes clips already present in the pre-submit baseline", () => {
    const clips = [
      clip({ id: "old-take", title: "Cold Banquet", created_at: AFTER }),
      clip({ id: "new-take", title: "Cold Banquet", created_at: AFTER })
    ];
    const result = selectFreshFeedTakeUrls({
      clips,
      title: "Cold Banquet",
      sinceMs: SUBMIT_MS,
      baselineIds: new Set(["old-take"])
    });
    expect(result.urls).toEqual([feedClipSongUrl("new-take")]);
  });

  it("excludes a different song's clip (cross-song bleed cannot happen on the feed)", () => {
    const clips = [
      clip({ id: "mine", title: "Cold Banquet", created_at: AFTER }),
      clip({ id: "neighbour", title: "Crossing Selloff", created_at: AFTER })
    ];
    const result = selectFreshFeedTakeUrls({
      clips,
      title: "Cold Banquet",
      sinceMs: SUBMIT_MS,
      baselineIds: new Set()
    });
    expect(result.urls).toEqual([feedClipSongUrl("mine")]);
  });

  it("excludes clips created before submit (minus skew tolerance)", () => {
    const clips = [clip({ id: "stale", title: "Cold Banquet", created_at: BEFORE })];
    const result = selectFreshFeedTakeUrls({
      clips,
      title: "Cold Banquet",
      sinceMs: SUBMIT_MS,
      baselineIds: new Set()
    });
    expect(result.urls).toEqual([]);
    expect(result.overCount).toBe(false);
  });

  it("keeps a clip a little before submit within the clock-skew tolerance", () => {
    const skewed = new Date(SUBMIT_MS - 30_000).toISOString();
    const clips = [clip({ id: "skewed", title: "Cold Banquet", created_at: skewed })];
    const result = selectFreshFeedTakeUrls({
      clips,
      title: "Cold Banquet",
      sinceMs: SUBMIT_MS,
      baselineIds: new Set()
    });
    expect(result.urls).toEqual([feedClipSongUrl("skewed")]);
  });

  it("rejects an over-count as a scope anomaly", () => {
    const clips = [
      clip({ id: "a", title: "Cold Banquet", created_at: AFTER }),
      clip({ id: "b", title: "Cold Banquet", created_at: AFTER }),
      clip({ id: "c", title: "Cold Banquet", created_at: AFTER })
    ];
    const result = selectFreshFeedTakeUrls({
      clips,
      title: "Cold Banquet",
      sinceMs: SUBMIT_MS,
      baselineIds: new Set()
    });
    expect(result.overCount).toBe(true);
    expect(result.urls).toEqual([]);
  });

  it("ignores clips with a missing or unparsable created_at", () => {
    const clips = [
      clip({ id: "no-ts", title: "Cold Banquet" }),
      clip({ id: "bad-ts", title: "Cold Banquet", created_at: "not-a-date" })
    ];
    const result = selectFreshFeedTakeUrls({
      clips,
      title: "Cold Banquet",
      sinceMs: SUBMIT_MS,
      baselineIds: new Set()
    });
    expect(result.urls).toEqual([]);
  });

  it("returns nothing for an untitled create (fail-closed like the DOM guard)", () => {
    const clips = [clip({ id: "x", title: "", created_at: AFTER })];
    const result = selectFreshFeedTakeUrls({
      clips,
      title: "",
      sinceMs: SUBMIT_MS,
      baselineIds: new Set()
    });
    expect(result.urls).toEqual([]);
    expect(result.overCount).toBe(false);
  });
});

describe("extractFeedClips", () => {
  it("reads a bare array body", () => {
    expect(extractFeedClips([{ id: "a" }]).length).toBe(1);
  });
  it("reads the clips/songs/data envelope shapes", () => {
    expect(extractFeedClips({ clips: [{ id: "a" }] }).length).toBe(1);
    expect(extractFeedClips({ songs: [{ id: "b" }] }).length).toBe(1);
    expect(extractFeedClips({ data: [{ id: "c" }] }).length).toBe(1);
  });
  it("returns [] for an unrecognised shape", () => {
    expect(extractFeedClips({ nope: 1 })).toEqual([]);
    expect(extractFeedClips(null)).toEqual([]);
  });
});

describe("fetchSunoFeedClips", () => {
  const clerkOk = async () => ({ getClerkToken: async () => ({ jwt: "jwt-token" }) });

  function fakeFetch(handler: (url: string) => { ok: boolean; status: number; body: unknown }): typeof fetch {
    return (async (url: string) => {
      const r = handler(String(url));
      return {
        ok: r.ok,
        status: r.status,
        json: async () => r.body
      };
    }) as unknown as typeof fetch;
  }

  it("returns clips from the first listing shape that responds 200", async () => {
    const clips = await fetchSunoFeedClips({
      sessionFile: "/tmp/session.json",
      fetchImpl: fakeFetch(() => ({ ok: true, status: 200, body: { clips: [{ id: "a" }] } })),
      clerkLoader: clerkOk
    });
    expect(clips).toEqual([{ id: "a" }]);
  });

  it("sends the JWT only as an Authorization header (never returned/logged)", async () => {
    let seenAuth: string | undefined;
    const fetchImpl = (async (_url: string, init: { headers: Record<string, string> }) => {
      seenAuth = init.headers.authorization;
      return { ok: true, status: 200, json: async () => [{ id: "z" }] };
    }) as unknown as typeof fetch;
    await fetchSunoFeedClips({ sessionFile: "/tmp/s.json", fetchImpl, clerkLoader: clerkOk });
    expect(seenAuth).toBe("Bearer jwt-token");
  });

  it("falls through to the next path on a non-ok response", async () => {
    const clips = await fetchSunoFeedClips({
      sessionFile: "/tmp/session.json",
      fetchImpl: fakeFetch((url) =>
        url.includes("v3")
          ? { ok: false, status: 404, body: null }
          : { ok: true, status: 200, body: [{ id: "v2clip" }] }
      ),
      clerkLoader: clerkOk
    });
    expect(clips).toEqual([{ id: "v2clip" }]);
  });

  it("returns [] when the JWT cannot be minted", async () => {
    const clips = await fetchSunoFeedClips({
      sessionFile: "/tmp/session.json",
      fetchImpl: fakeFetch(() => ({ ok: true, status: 200, body: [{ id: "a" }] })),
      clerkLoader: async () => ({ getClerkToken: async () => ({ jwt: undefined }) })
    });
    expect(clips).toEqual([]);
  });

  it("returns [] when the Clerk loader throws", async () => {
    const clips = await fetchSunoFeedClips({
      sessionFile: "/tmp/session.json",
      fetchImpl: fakeFetch(() => ({ ok: true, status: 200, body: [{ id: "a" }] })),
      clerkLoader: async () => {
        throw new Error("no session");
      }
    });
    expect(clips).toEqual([]);
  });
});
