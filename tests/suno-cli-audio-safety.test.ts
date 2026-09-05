import { describe, expect, it } from "vitest";
import { normalizeClip } from "../vendor/suno-cli/dist/src/http/feed.js";

describe("vendored suno-cli audio readiness", () => {
  it("does not mark the /api/forbidden audio placeholder as ready", () => {
    const clip = normalizeClip({
      id: "clip-forbidden-placeholder",
      audio_url: "https://studio-api.prod.suno.com/api/forbidden",
      status: "complete"
    });

    expect(clip).toMatchObject({
      audioReady: false,
      audioUrl: "https://studio-api.prod.suno.com/api/forbidden",
      status: "complete"
    });
  });
});
