import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes/index.js";
import { readSongState, updateSongState } from "../src/services/artistState.js";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { readAutopilotRunState, writeAutopilotRunState } from "../src/services/autopilotService.js";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles.js";

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

async function parkedWorkspace(songId = "parked-song"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-retry-pack-"));
  await ensureArtistWorkspace(root);
  await mkdir(join(root, "songs", songId, "lyrics"), { recursive: true });
  await writeFile(join(root, "songs", songId, "brief.md"), "# Brief\n- Mood: cold\n- Tempo: 128 BPM\n", "utf8");
  await createAndPersistSunoPromptPack({
    workspaceRoot: root,
    songId,
    songTitle: "Parked Signal",
    artistReason: "initial prompt pack",
    lyricsText: "[Verse 1]\nunder a dead relay\n[Chorus]\nwe keep the signal alive\n",
    knowledgePackVersion: "local-dev",
    deferDegradedNotification: true
  });
  await updateSongState(root, songId, {
    status: "failed",
    degradedLyrics: true,
    reason: "parked_needs_operator: lyrics_generation_degraded: suno_prompt_pack_invalid: fixture"
  });
  await writeAutopilotRunState(root, { stage: "planning", paused: false, retryCount: 0, cycleCount: 0, updatedAt: new Date().toISOString() });
  return root;
}

describe("retry prompt pack route", () => {
  it("rebuilds a parked song pack, returns it to the generation lane, and audits without a Suno run", async () => {
    const root = await parkedWorkspace();
    const handler = songsHandler();
    const res = response();

    await handler(request("/plugins/artist-runtime/api/songs/parked-song/retry-prompt-pack", root), res.res);

    expect(res.json()).toMatchObject({ retried: true, statusCode: 200, songId: "parked-song" });
    expect(await readSongState(root, "parked-song")).toMatchObject({ status: "suno_prompt_pack", degradedLyrics: false });
    expect(await readAutopilotRunState(root)).toMatchObject({ currentSongId: "parked-song", stage: "suno_generation" });
    expect(readFileSync(join(root, "songs", "parked-song", "audit", "actions.jsonl"), "utf8")).toContain('"reason":"retry_prompt_pack"');
    expect(() => readFileSync(join(root, "songs", "parked-song", "suno", "runs.jsonl"), "utf8")).toThrow();
  });

  it("rejects non-parked songs without mutation", async () => {
    const root = await parkedWorkspace("not-parked");
    await updateSongState(root, "not-parked", { status: "failed", reason: "ordinary_failure" });
    const before = await readSongState(root, "not-parked");
    const res = response();

    await songsHandler()(request("/plugins/artist-runtime/api/songs/not-parked/retry-prompt-pack", root), res.res);

    expect(res.json()).toMatchObject({ retried: false, statusCode: 409 });
    expect(await readSongState(root, "not-parked")).toEqual(before);
  });

  it("leaves failed state and autopilot unchanged when validation fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-retry-invalid-"));
    await ensureArtistWorkspace(root);
    await mkdir(join(root, "songs", "invalid-song", "lyrics"), { recursive: true });
    await writeFile(join(root, "songs", "invalid-song", "lyrics", "lyrics.v1.md"), "[Verse 1]\n蜃気楼のまち\n", "utf8");
    await updateSongState(root, "invalid-song", { title: "Invalid Signal", status: "failed", lyricsVersion: 1, degradedLyrics: true, reason: "parked_needs_operator: invalid" });
    await writeAutopilotRunState(root, { stage: "planning", paused: false, retryCount: 0, cycleCount: 0, updatedAt: new Date().toISOString() });
    const beforeSong = await readSongState(root, "invalid-song");
    const beforeState = await readAutopilotRunState(root);
    const res = response();

    await songsHandler()(request("/plugins/artist-runtime/api/songs/invalid-song/retry-prompt-pack", root), res.res);

    expect(res.json()).toMatchObject({ retried: false, statusCode: 422 });
    expect(await readSongState(root, "invalid-song")).toEqual(beforeSong);
    expect(await readAutopilotRunState(root)).toEqual(beforeState);
  });
});
