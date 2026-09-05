import { describe, expect, it } from "vitest";
import { FeedClient } from "../vendor/suno-cli/dist/src/http/feed.js";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("vendored suno-cli feed target filtering", () => {
  it("keeps only requested clips in request order when the feed is broad", async () => {
    const client = new FeedClient({
      jwt: "test-jwt",
      fetcher: async () => response({
        clips: [
          { id: "unrelated", title: "Unrelated", audio_url: "https://cdn.test/unrelated.mp3" },
          { id: "target-b", title: "B", audio_url: "https://cdn.test/b.mp3" },
          { id: "target-a", title: "A", audio_url: "https://cdn.test/a.mp3" },
        ],
      }),
    });

    await expect(client.getClips(["target-a", "target-b"])).resolves.toMatchObject([
      { clipId: "target-a", title: "A" },
      { clipId: "target-b", title: "B" },
    ]);
  });

  it("fails closed when the feed omits a requested clip", async () => {
    const client = new FeedClient({
      jwt: "test-jwt",
      fetcher: async () => response({ clips: [{ id: "target-a", audio_url: "https://cdn.test/a.mp3" }] }),
    });

    await expect(client.getClips(["target-a", "target-b"])).rejects.toThrow(
      "Suno feed response missing requested clip id(s): target-b",
    );
  });
});
