import { describe, expect, it, vi } from "vitest";
import { classifyError, ExitCode } from "../vendor/suno-cli/dist/src/commands/output.js";
import { downloadCommand } from "../vendor/suno-cli/dist/src/commands/download.js";
import { FeedClient, normalizeClip } from "../vendor/suno-cli/dist/src/http/feed.js";
import { resolveTarget } from "../vendor/suno-cli/dist/src/commands/resolve-target.js";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("vendored suno-cli feed target filtering", () => {
  const targetA = "8b849deb-f167-4ecb-98f5-335a59b85088";
  const targetB = "9b849deb-f167-4ecb-98f5-335a59b85088";

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

    const missingTarget = client.getClips(["target-a", "target-b"]);
    await expect(missingTarget).rejects.toThrow("Suno feed response missing requested clip id(s): target-b");
    await expect(missingTarget.catch((error: unknown) => classifyError(error))).resolves.toBe(ExitCode.retryableUnknown);
  });

  it("does not broaden an explicit clip UUID or song URL to a ledger run", async () => {
    const group = { runId: "group-run", clipIds: [targetA, targetB], songUrls: [], status: "accepted" };
    const ledger = { findRun: async () => group };

    await expect(resolveTarget(targetA, ledger)).resolves.toMatchObject({ clipIds: [targetA], run: { runId: `clip_${targetA}` } });
    await expect(resolveTarget(`https://suno.com/song/${targetA}`, ledger)).resolves.toMatchObject({
      clipIds: [targetA],
      run: { runId: `clip_${targetA}` },
    });
    await expect(resolveTarget("group-run", ledger)).resolves.toMatchObject({ clipIds: [targetA, targetB], run: group });
  });
});

describe("vendored suno-cli media_urls audio fallback", () => {
  it("falls back to a progressive media_urls entry when audio_url is the forbidden placeholder", () => {
    const clip = normalizeClip({
      id: "clip-1",
      audio_url: "https://studio-api.prod.suno.com/api/forbidden",
      media_urls: [
        { url: "https://cdn.test/clip-1.m4a", content_type: "m4a-opus", delivery: "progressive" },
      ],
    });

    expect(clip.audioReady).toBe(true);
    expect(clip.audioUrl).toBe("https://cdn.test/clip-1.m4a");
    expect(clip.audioFormat).toBe("m4a");
  });

  it("prefers a ready audio_url over media_urls", () => {
    const clip = normalizeClip({
      id: "clip-2",
      audio_url: "https://cdn.test/clip-2.mp3",
      media_urls: [{ url: "https://cdn.test/clip-2.m4a", content_type: "m4a-opus", delivery: "progressive" }],
    });

    expect(clip.audioReady).toBe(true);
    expect(clip.audioUrl).toBe("https://cdn.test/clip-2.mp3");
  });

  it("stays not-ready when neither audio_url nor media_urls resolve", () => {
    const clip = normalizeClip({
      id: "clip-3",
      audio_url: "https://studio-api.prod.suno.com/api/forbidden",
      media_urls: [],
    });

    expect(clip.audioReady).toBe(false);
    expect(clip.audioUrl).toBe("https://studio-api.prod.suno.com/api/forbidden");
  });
});

describe("vendored suno-cli download naming", () => {
  it("saves a media_urls-sourced clip with its real extension", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "suno-cli-download-test-"));
    const clipId = "8b849deb-f167-4ecb-98f5-335a59b85088";

    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const context = {
      ledger: { upsertRun: vi.fn(async () => undefined) },
      feed: {
        getClips: async () => [
          normalizeClip({
            id: clipId,
            audio_url: "https://studio-api.prod.suno.com/api/forbidden",
            media_urls: [{ url: "https://cdn.test/clip.m4a", content_type: "m4a-opus", delivery: "progressive" }],
          }),
        ],
      },
    };
    const options = { outDir, timeoutMs: 1000, pollMs: 10, fetcher };

    await downloadCommand(clipId, options, context as never);

    const files = await fs.readdir(outDir);
    expect(files).toEqual([`${clipId}.m4a`]);
  });
});
