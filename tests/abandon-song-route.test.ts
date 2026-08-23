import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes/index.js";
import { ensureSongState, readSongState, updateSongState } from "../src/services/artistState.js";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService.js";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus.js";

function request(url: string, root: string): IncomingMessage {
  const req = Readable.from([JSON.stringify({ config: { artist: { workspaceRoot: root } } })]) as IncomingMessage;
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
      body += chunk ? Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk : "";
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

async function workspaceWithSong(songId: string, status: "brief" | "lyrics" = "brief", currentSongId = songId): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-abandon-"));
  await ensureArtistWorkspace(root);
  await ensureSongState(root, songId, "Abandon Candidate");
  await updateSongState(root, songId, { status });
  await writeAutopilotRunState(root, {
    stage: "planning",
    currentSongId,
    paused: false,
    retryCount: 0,
    cycleCount: 0,
    updatedAt: new Date().toISOString()
  });
  return root;
}

async function writeAcceptedRun(root: string, songId: string): Promise<void> {
  await mkdir(join(root, "songs", songId, "suno"), { recursive: true });
  await writeFile(
    join(root, "songs", songId, "suno", "runs.jsonl"),
    `${JSON.stringify({ runId: "run-1", status: "accepted", createdAt: new Date().toISOString() })}\n`,
    "utf8"
  );
}

describe("abandon song route", () => {
  it("marks a non-terminal current-lane song failed, clears the lane, audits, and emits", async () => {
    const root = await workspaceWithSong("song-201");
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => {
      if (event.type === "song_abandoned") events.push(event);
    });
    const res = response();

    await songsHandler()(request("/plugins/artist-runtime/api/songs/song-201/abandon", root), res.res);
    unsubscribe();

    expect(res.json()).toMatchObject({ abandoned: true, statusCode: 200, songId: "song-201", clearedCurrentSong: true });
    expect(await readSongState(root, "song-201")).toMatchObject({ status: "failed", lastReason: "abandoned_by_operator" });
    const clearedState = await readAutopilotRunState(root);
    expect(clearedState.currentSongId).toBeUndefined();
    expect(clearedState.stage).toBe("planning");
    expect(readFileSync(join(root, "songs", "song-201", "audit", "actions.jsonl"), "utf8")).toContain('"eventType":"abandon_song"');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "song_abandoned", songId: "song-201", fromStatus: "brief" });
  });

  it("refuses with 409 when an accepted Suno run exists and mutates nothing", async () => {
    const root = await workspaceWithSong("song-202");
    await writeAcceptedRun(root, "song-202");
    const before = await readSongState(root, "song-202");
    const beforeState = await readAutopilotRunState(root);
    const res = response();

    await songsHandler()(request("/plugins/artist-runtime/api/songs/song-202/abandon", root), res.res);

    expect(res.json()).toMatchObject({ abandoned: false, statusCode: 409, reason: "song_has_accepted_suno_run" });
    expect(await readSongState(root, "song-202")).toEqual(before);
    expect(await readAutopilotRunState(root)).toEqual(beforeState);
  });

  it("abandons a non-current song without touching the active currentSongId lane", async () => {
    const root = await workspaceWithSong("song-203", "brief", "song-999");
    const res = response();

    await songsHandler()(request("/plugins/artist-runtime/api/songs/song-203/abandon", root), res.res);

    expect(res.json()).toMatchObject({ abandoned: true, statusCode: 200, songId: "song-203", clearedCurrentSong: false });
    expect(await readSongState(root, "song-203")).toMatchObject({ status: "failed", lastReason: "abandoned_by_operator" });
    expect(await readAutopilotRunState(root)).toMatchObject({ currentSongId: "song-999" });
  });

  it("refuses with 409 when the song is already terminal", async () => {
    const root = await workspaceWithSong("song-204");
    await updateSongState(root, "song-204", { status: "published" });
    const res = response();

    await songsHandler()(request("/plugins/artist-runtime/api/songs/song-204/abandon", root), res.res);

    expect(res.json()).toMatchObject({ abandoned: false, statusCode: 409 });
    expect(await readSongState(root, "song-204")).toMatchObject({ status: "published" });
  });
});
