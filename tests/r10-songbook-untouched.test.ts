import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { registerRoutes } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { ensureSongState, updateSongState } from "../src/services/artistState";
import { readResolvedConfig } from "../src/services/runtimeConfig";

function request(method: string, url: string, body: unknown): IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  req.method = method;
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
      body += chunk ? Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk : "";
      this.headersSent = true;
      return this;
    }
  } as unknown as ServerResponse;
  return { res, json: () => JSON.parse(body) as Record<string, unknown> };
}

function songbookHandler() {
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({ registerHttpRoute(def: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) { routes.set(def.path, def.handler); } });
  const handler = routes.get("/plugins/artist-runtime/api/songbook/lookup");
  if (!handler) {
    throw new Error("songbook route missing");
  }
  return handler;
}

describe("R10 songbook sync boundary", () => {
  it("syncs SONGBOOK links without changing dry-run or live arm flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-r10-songbook-"));
    await ensureArtistWorkspace(root);
    await ensureSongState(root, "where-it-played", "Where It Played");
    await updateSongState(root, "where-it-played", { status: "published" });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      text: async () => JSON.stringify({ results: [{ wrapperType: "track", trackName: "Where It Played", trackViewUrl: "https://music.apple.com/jp/song/where-it-played/1" }] })
    })));
    const before = await readResolvedConfig(root);
    const res = response();

    await songbookHandler()(request("POST", "/plugins/artist-runtime/api/songbook/lookup", { config: { artist: { workspaceRoot: root } } }), res.res);
    const after = await readResolvedConfig(root);

    expect(res.json().updated).toEqual([]);
    expect(after.autopilot.dryRun).toBe(before.autopilot.dryRun);
    expect(after.distribution.liveGoArmed).toBe(before.distribution.liveGoArmed);
    expect(after.distribution.platforms.x.liveGoArmed).toBe(before.distribution.platforms.x.liveGoArmed);
    vi.unstubAllGlobals();
  });
});
