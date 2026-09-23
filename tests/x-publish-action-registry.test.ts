import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { SongState } from "../src/types";
import {
  buildXPostDraft,
  effectiveTweetLength,
  executeXPublishAction,
  fitXPostText,
  hashXPostText,
  normalizeXPostText,
  parseTweetUrl
} from "../src/services/xPublishActionRegistry";
import { isXInlineButtonEnabled } from "../src/services/runtimeConfig";

function song(overrides: Partial<SongState> = {}): SongState {
  return {
    songId: "where-it-played",
    title: "Where It Played",
    status: "take_selected",
    updatedAt: "2026-04-29T00:00:00.000Z",
    publicLinks: [],
    runCount: 1,
    ...overrides
  };
}

function mockSpawn(results: Array<{ code?: number | null; stdout?: string; stderr?: string; errorCode?: string }>) {
  const calls: string[][] = [];
  const spawnImpl = ((_command: string, args: string[]) => {
    calls.push(args);
    const result = results.shift() ?? { code: 0, stdout: "" };
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    process.nextTick(() => {
      if (result.stdout) {
        child.stdout.emit("data", result.stdout);
      }
      if (result.stderr) {
        child.stderr.emit("data", result.stderr);
      }
      if (result.errorCode) {
        const error = new Error(result.errorCode) as NodeJS.ErrnoException;
        error.code = result.errorCode;
        child.emit("error", error);
        return;
      }
      child.emit("close", result.code ?? 0);
    });
    return child;
  }) as never;
  return { spawnImpl, calls };
}

describe("x publish action registry", () => {
  it("keeps the X inline button retreat flag default-on and off-switchable", () => {
    expect(isXInlineButtonEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isXInlineButtonEnabled({ OPENCLAW_X_INLINE_BUTTON: "off" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("normalizes and hashes draft text deterministically", () => {
    expect(normalizeXPostText(" hello\r\nworld \n")).toBe("hello\nworld");
    expect(hashXPostText(" hello\r\nworld ")).toBe(hashXPostText("hello\nworld"));
  });

  it("builds an artist-voice X draft with one URL and effective length budget", async () => {
    const draft = await buildXPostDraft({
      root: "/tmp/unused",
      songState: song({ publicLinks: ["https://suno.com/song/abc"] }),
      generateResponse: async () => ({
        text: "できた。消えかけの街灯の下で鳴る曲。 https://other.example/ignored",
        suggestedActions: []
      })
    });

    expect(draft.draftText).toContain("https://suno.com/song/abc");
    expect(draft.draftText).not.toContain("other.example");
    expect(draft.draftHash).toBe(hashXPostText(draft.draftText));
    expect(draft.draftCharCount).toBe(effectiveTweetLength(draft.draftText, draft.draftUrl));
    expect(draft.draftCharCount).toBeLessThanOrEqual(280);
  });

  it("truncates long drafts by budget before appending the URL", () => {
    const fitted = fitXPostText(`${"長い文。".repeat(140)}終わり。`, "https://suno.com/song/abc");
    expect(fitted).toContain("https://suno.com/song/abc");
    expect(effectiveTweetLength(fitted, "https://suno.com/song/abc")).toBeLessThanOrEqual(280);
    expect(fitted).toContain("...");
  });

  it("rejects secret-like input, AI response, and final text", async () => {
    const secretLike = ["COOKIE", "leak1234"].join("=");
    await expect(buildXPostDraft({
      root: "/tmp/unused",
      songState: song({ title: secretLike }),
      generateResponse: async () => ({ text: "safe", suggestedActions: [] })
    })).rejects.toThrow("x_publish_input_contains_secret_like_text");

    await expect(buildXPostDraft({
      root: "/tmp/unused",
      songState: song(),
      generateResponse: async () => ({ text: secretLike, suggestedActions: [] })
    })).rejects.toThrow("x_publish_ai_response_contains_secret_like_text");

    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      finalText: secretLike,
      spawnImpl: mockSpawn([]).spawnImpl
    })).rejects.toThrow("x_publish_final_text_contains_secret_like_text");
  });

  it("posts through bird tweet after whoami and parses the tweet URL", async () => {
    const { spawnImpl, calls } = mockSpawn([
      { code: 0, stdout: "@test_artist" },
      { code: 0, stdout: "posted https://x.com/test_artist/status/1234567890" }
    ]);
    const result = await executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      entry: {
        draftText: "できた\nhttps://suno.com/song/abc",
        draftHash: hashXPostText("できた\nhttps://suno.com/song/abc"),
        draftUrl: "https://suno.com/song/abc"
      },
      spawnImpl
    });

    expect(result).toMatchObject({
      status: "published",
      tweetUrl: "https://x.com/test_artist/status/1234567890",
      birdStatus: "tweet_posted"
    });
    expect(calls).toEqual([
      ["whoami", "--plain"],
      ["--plain", "tweet", "できた\nhttps://suno.com/song/abc"]
    ]);
  });

  it("maps bird auth and publish failures", async () => {
    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      finalText: "draft",
      spawnImpl: mockSpawn([{ errorCode: "ENOENT" }]).spawnImpl
    })).resolves.toMatchObject({ status: "failed", reason: "bird_cli_not_installed" });

    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      finalText: "draft",
      spawnImpl: mockSpawn([{ code: 1, stderr: "missing auth cookie" }]).spawnImpl
    })).resolves.toMatchObject({ status: "failed", reason: "bird_auth_missing" });

    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      finalText: "draft",
      spawnImpl: mockSpawn([{ code: 1, stderr: "401 could not authenticate" }]).spawnImpl
    })).resolves.toMatchObject({ status: "failed", reason: "bird_auth_expired" });

    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      finalText: "draft",
      spawnImpl: mockSpawn([
        { code: 0, stdout: "@test_artist" },
        { code: 1, stderr: "429 rate limit" }
      ]).spawnImpl
    })).resolves.toMatchObject({ status: "failed", reason: "bird_rate_limited" });

    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      finalText: "draft",
      spawnImpl: mockSpawn([
        { code: 0, stdout: "@test_artist" },
        { code: 1, stderr: "boom" }
      ]).spawnImpl
    })).resolves.toMatchObject({ status: "failed", reason: "bird_publish_failed" });
  });

  it("fails when bird returns success without a tweet URL or hash does not match", async () => {
    expect(parseTweetUrl("posted https://twitter.com/test_artist/status/123")).toBe("https://twitter.com/test_artist/status/123");

    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      finalText: "changed",
      entry: { draftText: "draft", draftHash: hashXPostText("draft") },
      spawnImpl: mockSpawn([]).spawnImpl
    })).resolves.toMatchObject({ status: "failed", reason: "x_publish_hash_mismatch" });

    await expect(executeXPublishAction({
      root: "/tmp/unused",
      songId: "where-it-played",
      action: "x_publish_confirm",
      finalText: "draft",
      spawnImpl: mockSpawn([
        { code: 0, stdout: "@test_artist" },
        { code: 0, stdout: "posted" }
      ]).spawnImpl
    })).resolves.toMatchObject({ status: "failed", reason: "bird_publish_missing_tweet_url" });
  });
});
