import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes";
import { patchResolvedConfig, readResolvedConfig, resolveRuntimeConfig } from "../src/services/runtimeConfig.js";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "config-update-"));
  mkdirSync(join(root, "runtime"), { recursive: true });
  return root;
}

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

describe("config/update behaviour", () => {
  it("patchResolvedConfig persists autopilot.enabled toggle to config-overrides.json", async () => {
    const root = makeWorkspace();

    const updated = await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, mode: "public_artist", artistId: "artist", profilePath: "ARTIST.md" },
      autopilot: { enabled: true, dryRun: true }
    });

    expect(updated.autopilot.enabled).toBe(true);
    expect(updated.autopilot.dryRun).toBe(true);

    const persisted = JSON.parse(readFileSync(join(root, "runtime", "config-overrides.json"), "utf8"));
    expect(persisted.autopilot.enabled).toBe(true);
  });

  it("readResolvedConfig reflects subsequent patch writes", async () => {
    const root = makeWorkspace();

    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, mode: "public_artist", artistId: "artist", profilePath: "ARTIST.md" },
      autopilot: { enabled: true }
    });

    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, mode: "public_artist", artistId: "artist", profilePath: "ARTIST.md" },
      autopilot: { songsPerWeek: 5 }
    });

    const resolved = await readResolvedConfig(root);
    expect(resolved.autopilot.enabled).toBe(true);
    expect(resolved.autopilot.songsPerWeek).toBe(5);
  });

  it("empty patch returns current resolved config without error", async () => {
    const root = makeWorkspace();

    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, mode: "public_artist", artistId: "artist", profilePath: "ARTIST.md" },
      autopilot: { enabled: true }
    });

    const result = await patchResolvedConfig(root, {});
    expect(result.autopilot.enabled).toBe(true);
  });

  it("patchResolvedConfig persists Producer Room locale overrides", async () => {
    const root = makeWorkspace();

    const updated = await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, mode: "public_artist", artistId: "artist", profilePath: "ARTIST.md" },
      ui: { locale: "ja" }
    });

    expect(updated.ui.locale).toBe("ja");

    const persisted = JSON.parse(readFileSync(join(root, "runtime", "config-overrides.json"), "utf8"));
    expect(persisted.ui.locale).toBe("ja");
  });

  it("patchResolvedConfig persists dashboard base URL overrides", async () => {
    const root = makeWorkspace();

    const updated = await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, mode: "public_artist", artistId: "artist", profilePath: "ARTIST.md" },
      dashboard: { baseUrl: "https://tailnet.example.test" }
    });

    expect(updated.dashboard.baseUrl).toBe("https://tailnet.example.test");

    const persisted = JSON.parse(readFileSync(join(root, "runtime", "config-overrides.json"), "utf8"));
    expect(persisted.dashboard.baseUrl).toBe("https://tailnet.example.test");
  });

  it("resolveRuntimeConfig merges persisted overrides with payload config", async () => {
    const root = makeWorkspace();

    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, mode: "public_artist", artistId: "artist", profilePath: "ARTIST.md" },
      autopilot: { enabled: true, dryRun: true, songsPerWeek: 6 }
    });

    const resolved = await resolveRuntimeConfig({
      artist: { workspaceRoot: root },
      autopilot: { cycleIntervalMinutes: 15 }
    });

    expect(resolved.autopilot.enabled).toBe(true);
    expect(resolved.autopilot.songsPerWeek).toBe(6);
    expect(resolved.autopilot.cycleIntervalMinutes).toBe(15);
  });

  it("config/update route preserves persisted settings when patching through payload config context", async () => {
    const root = makeWorkspace();
    await patchResolvedConfig(root, {
      artist: { workspaceRoot: root, mode: "public_artist", artistId: "artist", profilePath: "ARTIST.md" },
      autopilot: { enabled: true, dryRun: true, songsPerWeek: 6 }
    });

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/config/update");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/config/update",
        JSON.stringify({
          config: { artist: { workspaceRoot: root } },
          patch: { autopilot: { cycleIntervalMinutes: 15 } }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(response.readHeader("content-type")).toContain("application/json");

    const updated = JSON.parse(response.readBody()) as Awaited<ReturnType<typeof readResolvedConfig>>;
    expect(updated.autopilot.enabled).toBe(true);
    expect(updated.autopilot.songsPerWeek).toBe(6);
    expect(updated.autopilot.cycleIntervalMinutes).toBe(15);
  });

  it("config/update route persists global and platform live-go arms but keeps TikTok frozen", async () => {
    const root = makeWorkspace();

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/config/update");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/config/update",
        JSON.stringify({
          config: { artist: { workspaceRoot: root } },
          patch: {
            distribution: {
              liveGoArmed: true,
              platforms: {
                x: { liveGoArmed: true },
                instagram: { liveGoArmed: true },
                tiktok: { liveGoArmed: true }
              }
            }
          }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(response.readHeader("content-type")).toContain("application/json");

    const updated = JSON.parse(response.readBody()) as Awaited<ReturnType<typeof readResolvedConfig>>;
    expect(updated.distribution.liveGoArmed).toBe(true);
    expect(updated.distribution.platforms.x.liveGoArmed).toBe(true);
    expect(updated.distribution.platforms.instagram.liveGoArmed).toBe(true);
    expect(updated.distribution.platforms.tiktok.liveGoArmed).toBe(false);
  });

  it("config/update route persists Suno daily credit limit edits", async () => {
    const root = makeWorkspace();

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/config/update");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/config/update",
        JSON.stringify({
          config: { artist: { workspaceRoot: root } },
          patch: {
            music: {
              suno: {
                dailyCreditLimit: 120
              }
            }
          }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);

    const updated = JSON.parse(response.readBody()) as Awaited<ReturnType<typeof readResolvedConfig>>;
    expect(updated.music.suno.dailyCreditLimit).toBe(120);
  });

  it("config/update route persists Suno monthly credit limit edits", async () => {
    const root = makeWorkspace();

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/config/update");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/config/update",
        JSON.stringify({
          config: { artist: { workspaceRoot: root } },
          patch: {
            music: {
              suno: {
                monthlyCreditLimit: 240
              }
            }
          }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);

    const updated = JSON.parse(response.readBody()) as Awaited<ReturnType<typeof readResolvedConfig>>;
    expect(updated.music.suno.monthlyCreditLimit).toBe(240);
  });

  it("config/update route rejects invalid Suno daily credit limits through schema validation", async () => {
    const root = makeWorkspace();

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/config/update");
    expect(handler).toBeTruthy();

    await expect(
      handler?.(
        createMockRequest(
          "POST",
          "/plugins/artist-runtime/api/config/update",
          JSON.stringify({
            config: { artist: { workspaceRoot: root } },
            patch: {
              music: {
                suno: {
                  dailyCreditLimit: 0
                }
              }
            }
          }),
          { "content-type": "application/json" }
        ),
        createMockResponse().res
      )
    ).rejects.toThrow("invalid config: config.music.suno.dailyCreditLimit must be an integer between 1 and 1000");
  });

  it("config/update route rejects invalid Suno monthly credit limits through schema validation", async () => {
    const root = makeWorkspace();

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/config/update");
    expect(handler).toBeTruthy();

    await expect(
      handler?.(
        createMockRequest(
          "POST",
          "/plugins/artist-runtime/api/config/update",
          JSON.stringify({
            config: { artist: { workspaceRoot: root } },
            patch: {
              music: {
                suno: {
                  monthlyCreditLimit: 50001
                }
              }
            }
          }),
          { "content-type": "application/json" }
        ),
        createMockResponse().res
      )
    ).rejects.toThrow("invalid config: config.music.suno.monthlyCreditLimit must be an integer between 0 and 50000");
  });
});
