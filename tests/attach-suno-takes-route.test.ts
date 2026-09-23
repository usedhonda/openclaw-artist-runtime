import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes/index.js";
import { attachSunoTakes } from "../src/services/attachSunoTakesService.js";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState.js";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus.js";
import type { SunoFeedFetchResult } from "../src/services/sunoFeedHarvest.js";

const TAKE_A = "https://suno.com/song/11111111-1111-4111-8111-111111111111";
const TAKE_B = "https://suno.com/song/22222222-2222-4222-8222-222222222222";

async function workspaceWithSong(songId: string, title: string, status: "suno_running" | "failed" = "suno_running"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-attach-takes-"));
  await ensureArtistWorkspace(root);
  await ensureSongState(root, songId, title);
  await updateSongState(root, songId, { status });
  return root;
}

function feedAvailable(clips: Array<{ id: string; title: string }>): () => Promise<SunoFeedFetchResult> {
  return async () => ({ clips, available: true });
}

function feedUnavailable(reason: SunoFeedFetchResult["reason"] = "clerk_token_missing"): () => Promise<SunoFeedFetchResult> {
  return async () => ({ clips: [], available: false, reason });
}

describe("attachSunoTakes (service)", () => {
  afterEach(() => {
    getRuntimeEventBus().clearForTest();
  });

  it("attaches feed-verified takes: appends an accepted run, advances the song, audits, and emits", async () => {
    const root = await workspaceWithSong("song-401", "Neon Alley");
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));

    const result = await attachSunoTakes(
      root,
      "song-401",
      { urls: [TAKE_A, TAKE_B], reason: "manual create confirmed via feed" },
      undefined,
      { fetchStatus: feedAvailable([
        { id: "11111111-1111-4111-8111-111111111111", title: "Neon Alley" },
        { id: "22222222-2222-4222-8222-222222222222", title: "Neon Alley" }
      ]) }
    );
    unsubscribe();

    expect(result).toMatchObject({ attached: true, statusCode: 200, songId: "song-401", urls: [TAKE_A, TAKE_B] });
    expect(result.attached && result.runId.startsWith("operator_attach_")).toBe(true);

    const song = await readSongState(root, "song-401");
    expect(song.status).toBe("suno_take_url_ready");
    expect(song.publicLinks).toEqual(expect.arrayContaining([TAKE_A, TAKE_B]));

    const runsRaw = readFileSync(join(root, "songs", "song-401", "suno", "runs.jsonl"), "utf8");
    expect(runsRaw).toContain('"status":"accepted"');
    expect(runsRaw).toContain("operator attach: manual create confirmed via feed");

    const audit = readFileSync(join(root, "runtime", "take-attribution-audit.jsonl"), "utf8");
    expect(audit).toContain("take_attribution_operator_attach");

    expect(events).toContainEqual(expect.objectContaining({
      type: "suno_take_attached_by_operator",
      songId: "song-401",
      urls: [TAKE_A, TAKE_B]
    }));
  });

  it("accepts a song parked as failed -- the exact lane a 3-strike suno_generate_failed leaves it in", async () => {
    const root = await workspaceWithSong("song-402", "Neon Alley", "failed");

    const result = await attachSunoTakes(
      root,
      "song-402",
      { urls: [TAKE_A] },
      undefined,
      { fetchStatus: feedAvailable([{ id: "11111111-1111-4111-8111-111111111111", title: "Neon Alley" }]) }
    );

    expect(result).toMatchObject({ attached: true, statusCode: 200 });
    expect((await readSongState(root, "song-402")).status).toBe("suno_take_url_ready");
  });

  it("rejects a non-UUID take URL with 400 and mutates nothing", async () => {
    const root = await workspaceWithSong("song-403", "Neon Alley");
    const before = await readSongState(root, "song-403");

    const result = await attachSunoTakes(root, "song-403", { urls: ["https://suno.com/song/not-a-uuid"] });

    expect(result).toMatchObject({ attached: false, statusCode: 400, reason: "invalid_take_url:https://suno.com/song/not-a-uuid" });
    expect(await readSongState(root, "song-403")).toEqual(before);
  });

  it("rejects with 422 when the feed clip's title does not match the song", async () => {
    const root = await workspaceWithSong("song-404", "Neon Alley");
    const before = await readSongState(root, "song-404");

    const result = await attachSunoTakes(
      root,
      "song-404",
      { urls: [TAKE_A] },
      undefined,
      { fetchStatus: feedAvailable([{ id: "11111111-1111-4111-8111-111111111111", title: "A Different Song" }]) }
    );

    expect(result).toMatchObject({ attached: false, statusCode: 422, reason: `take_title_mismatch:${TAKE_A}` });
    expect(await readSongState(root, "song-404")).toEqual(before);
  });

  it("refuses to attach blindly with 503 when the feed cannot be reached", async () => {
    const root = await workspaceWithSong("song-405", "Neon Alley");
    const before = await readSongState(root, "song-405");

    const result = await attachSunoTakes(
      root,
      "song-405",
      { urls: [TAKE_A] },
      undefined,
      { fetchStatus: feedUnavailable("clerk_token_missing") }
    );

    expect(result).toMatchObject({ attached: false, statusCode: 503, reason: "clerk_token_missing" });
    expect(await readSongState(root, "song-405")).toEqual(before);
  });

  it("rejects with 409 when a take URL is already attributed to another song", async () => {
    const root = await workspaceWithSong("song-406", "Neon Alley");
    await ensureSongState(root, "older-song", "Older Song");
    await updateSongState(root, "older-song", { status: "take_selected", appendPublicLinks: [TAKE_A] });

    const result = await attachSunoTakes(
      root,
      "song-406",
      { urls: [TAKE_A] },
      undefined,
      { fetchStatus: feedAvailable([{ id: "11111111-1111-4111-8111-111111111111", title: "Neon Alley" }]) }
    );

    expect(result).toMatchObject({ attached: false, statusCode: 409, reason: "take_attribution_collision" });
    expect(result.attached === false && result.statusCode === 409 && result.collisions).toEqual([
      expect.objectContaining({ songId: "older-song", url: TAKE_A })
    ]);
  });
});

describe("attach-takes route wiring", () => {
  function request(url: string, root: string, body: Record<string, unknown> = {}): IncomingMessage {
    const req = Readable.from([JSON.stringify({ config: { artist: { workspaceRoot: root } }, ...body })]) as IncomingMessage;
    req.method = "POST";
    req.url = url;
    req.headers = { "content-type": "application/json" };
    return req;
  }

  function response() {
    let body = "";
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader() { return this; },
      end(chunk?: string | Buffer) {
        body += chunk ? (Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk) : "";
        this.headersSent = true;
        return this;
      }
    } as unknown as ServerResponse;
    return { res, json: () => JSON.parse(body) as Record<string, unknown> };
  }

  function songsHandler() {
    const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void> | void>();
    registerRoutes({ registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void }) { routes.set(definition.path, definition.handler); } });
    const handler = routes.get("/plugins/artist-runtime/api/songs");
    if (!handler) throw new Error("songs route missing");
    return handler;
  }

  it("dispatches POST /api/songs/:songId/attach-takes to the service (400 on a malformed URL, no live feed call)", async () => {
    const root = await workspaceWithSong("song-407", "Neon Alley");
    const res = response();

    await songsHandler()(
      request("/plugins/artist-runtime/api/songs/song-407/attach-takes", root, { urls: ["not-a-url"] }),
      res.res
    );

    expect(res.json()).toMatchObject({ attached: false, statusCode: 400 });
  });

  it("rejects secret-like text in the reason field before reaching the service", async () => {
    const root = await workspaceWithSong("song-408", "Neon Alley");
    const res = response();

    await songsHandler()(
      request("/plugins/artist-runtime/api/songs/song-408/attach-takes", root, {
        urls: [TAKE_A],
        reason: "API_KEY: abcdefghijklmnopqrstuvwxyz0123456789"
      }),
      res.res
    );

    expect(res.json()).toMatchObject({ error: "secret_like_payload_rejected", statusCode: 400 });
  });
});
