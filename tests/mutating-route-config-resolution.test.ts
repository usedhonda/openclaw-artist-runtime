import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes";
import { updateSongState } from "../src/services/artistState";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { patchResolvedConfig } from "../src/services/runtimeConfig";
import { createSongIdea } from "../src/services/songIdeation";
import { createAndPersistSunoPromptPack } from "../src/services/sunoPromptPackFiles";

function createMockRequest(method: string, url: string, body?: string, headers?: Record<string, string>): IncomingMessage {
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = headers ?? {};
  return req;
}

function createMockResponse() {
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
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
    readBody: () => body,
    readHeader: (name: string) => headers[name.toLowerCase()],
    readStatus: () => (res as unknown as { statusCode: number }).statusCode
  };
}

function registeredRouteHandlers() {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      handlers.set(definition.path, definition.handler);
    }
  });
  return handlers;
}

describe("mutating route config resolution", () => {
  it("uses persisted authority overrides in platform test route", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-platform-test-route-"));
    await ensureArtistWorkspace(root);
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      distribution: {
        platforms: {
          x: { enabled: true, authority: "draft_only" }
        }
      }
    });

    const handler = registeredRouteHandlers().get("/plugins/artist-runtime/api/platforms");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/platforms/x/test",
        JSON.stringify({
          id: "x",
          config: { artist: { workspaceRoot: root } }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(response.readHeader("content-type")).toContain("application/json");
    expect(JSON.parse(response.readBody())).toMatchObject({
      platform: "x",
      status: {
        authority: "draft_only"
      }
    });
  });

  it("uses persisted platform enablement in social-assets route", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-social-assets-route-"));
    await ensureArtistWorkspace(root);
    const created = await createSongIdea({ workspaceRoot: root, title: "Ghost Station", artistReason: "relay hum" });
    await updateSongState(root, created.songId, {
      status: "take_selected",
      selectedTakeId: "take-1",
      reason: "selected for social asset prep"
    });
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      distribution: {
        platforms: {
          instagram: { enabled: true }
        }
      }
    });

    const handler = registeredRouteHandlers().get("/plugins/artist-runtime/api/songs");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        `/plugins/artist-runtime/api/songs/${created.songId}/social-assets`,
        JSON.stringify({
          songId: created.songId,
          config: { artist: { workspaceRoot: root } }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(JSON.parse(response.readBody())).toMatchObject([
      {
        songId: created.songId,
        platform: "instagram",
        postType: "lyric_card"
      }
    ]);
  });

  it("uses persisted music authority in Suno generate route", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-generate-route-"));
    await ensureArtistWorkspace(root);
    await createAndPersistSunoPromptPack({
      workspaceRoot: root,
      songId: "song-001",
      songTitle: "Ghost Station",
      artistReason: "frozen relay signal",
      lyricsText: "station glass under static",
      knowledgePackVersion: "test-pack"
    });
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root },
      autopilot: { dryRun: false },
      music: {
        suno: {
          authority: "prepare_only"
        }
      }
    });

    const handler = registeredRouteHandlers().get("/plugins/artist-runtime/api/suno");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/suno/generate/song-001",
        JSON.stringify({
          songId: "song-001",
          config: { artist: { workspaceRoot: root } }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(JSON.parse(response.readBody())).toMatchObject({
      songId: "song-001",
      dryRun: false,
      authorityDecision: {
        allowed: false,
        policyDecision: "deny_authority"
      },
      status: "blocked_authority"
    });
  });
});
