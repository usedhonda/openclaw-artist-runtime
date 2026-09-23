import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState, updateSongState } from "../src/services/artistState";

function createMockRequest(method: string, url: string, body?: string): IncomingMessage {
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = { "content-type": "application/json" };
  return req;
}

function createMockResponse() {
  let body = "";
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader() {
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      }
      this.headersSent = true;
      return this;
    }
  } as unknown as ServerResponse;

  return {
    res,
    json: () => JSON.parse(body) as Record<string, unknown>,
    readStatus: () => (res as unknown as { statusCode: number }).statusCode
  };
}

function registerSongsHandler() {
  const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      registered.set(definition.path, definition.handler);
    }
  });
  const handler = registered.get("/plugins/artist-runtime/api/songs");
  if (!handler) {
    throw new Error("songs route not registered");
  }
  return handler;
}

async function prepareWorkspace(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-songbook-route-"));
  await ensureArtistWorkspace(root);
  await updateSongState(root, "where-it-played", {
    title: "Where It Played",
    status: "take_selected",
    selectedTakeId: "take-1"
  });
  return root;
}

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void,
  method: string,
  url: string,
  root: string,
  payload: Record<string, unknown> = {}
) {
  const response = createMockResponse();
  await handler(
    createMockRequest(method, url, JSON.stringify({ ...payload, config: { artist: { workspaceRoot: root } } })),
    response.res
  );
  return response;
}

describe("songs route songbook action mirror", () => {
  it("applies song completion through the shared song publish action path", async () => {
    const root = await prepareWorkspace();
    const handler = registerSongsHandler();

    const response = await invoke(handler, "POST", "/plugins/artist-runtime/api/songs/where-it-played/songbook-write", root);
    const json = response.json();

    expect(response.readStatus()).toBe(200);
    expect(json).toMatchObject({
      action: "song_songbook_write",
      status: "applied",
      safety: { autopilotDryRun: true, liveGoArmed: false }
    });
    expect((await readSongState(root, "where-it-played")).status).toBe("published");
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toContain("| where-it-played | Where It Played | published |");
    const backups = json.backups as { entries?: Array<{ backupPath?: string }> };
    expect(backups.entries?.every((entry) => Boolean(entry.backupPath && existsSync(entry.backupPath)))).toBe(true);
  });

  it("skips song completion without changing song files", async () => {
    const root = await prepareWorkspace();
    const handler = registerSongsHandler();
    const beforeSong = readFileSync(join(root, "songs", "where-it-played", "song.md"), "utf8");
    const beforeSongbook = readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8");

    const response = await invoke(handler, "POST", "/plugins/artist-runtime/api/songs/where-it-played/songbook-skip", root);

    expect(response.json()).toMatchObject({ action: "song_skip", status: "discarded" });
    expect(readFileSync(join(root, "songs", "where-it-played", "song.md"), "utf8")).toBe(beforeSong);
    expect(readFileSync(join(root, "artist", "SONGBOOK.md"), "utf8")).toBe(beforeSongbook);
  });

  it("archives and discards producer review songs through the shared route", async () => {
    const archiveRoot = await prepareWorkspace();
    const handler = registerSongsHandler();

    const archiveResponse = await invoke(handler, "POST", "/plugins/artist-runtime/api/songs/where-it-played/archive", archiveRoot);
    expect(archiveResponse.json()).toMatchObject({
      action: "song_archive",
      status: "applied",
      song: { status: "archived", selectedTakeId: "take-1" }
    });
    expect((await readSongState(archiveRoot, "where-it-played")).status).toBe("archived");

    const discardRoot = await prepareWorkspace();
    const discardResponse = await invoke(handler, "POST", "/plugins/artist-runtime/api/songs/where-it-played/discard", discardRoot);
    expect(discardResponse.json()).toMatchObject({
      action: "song_discard",
      status: "discarded",
      song: { status: "discarded" }
    });
    const discarded = await readSongState(discardRoot, "where-it-played");
    expect(discarded.status).toBe("discarded");
    expect(discarded.selectedTakeId).toBeUndefined();
  });

  it("rejects secret-like free text payloads on the UI mirror route", async () => {
    const root = await prepareWorkspace();
    const handler = registerSongsHandler();
    const secretLike = ["TELEGRAM", "BOT", "TOKEN"].join("_");

    const response = await invoke(handler, "POST", "/plugins/artist-runtime/api/songs/where-it-played/songbook-write", root, {
      reason: `${secretLike}=placeholder`
    });

    expect(response.json()).toMatchObject({ error: "secret_like_payload_rejected" });
    expect((await readSongState(root, "where-it-played")).status).toBe("take_selected");
  });
});
