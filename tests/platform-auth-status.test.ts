import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlatformDetailResponse, registerRoutes } from "../src/routes/index.js";
import { validateConfig } from "../src/config/schema.js";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace.js";
import { readResolvedConfig, patchResolvedConfig } from "../src/services/runtimeConfig.js";
import type { ArtistRuntimeConfig } from "../src/types.js";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

interface SpawnStep {
  code?: number | null;
  stdout?: string;
  stderr?: string;
  errorCode?: string;
}

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function createSpawnMock(steps: SpawnStep[]) {
  let index = 0;
  return () => {
    const step = steps[index++];
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (!step) {
        child.emit("close", 1);
        return;
      }
      if (step.stdout) {
        child.stdout.emit("data", step.stdout);
      }
      if (step.stderr) {
        child.stderr.emit("data", step.stderr);
      }
      child.emit("close", step.code ?? 0);
    });
    return child;
  };
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
  return { res, readBody: () => body };
}

function platformRoute() {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      handlers.set(definition.path, definition.handler);
    }
  });
  const handler = handlers.get("/plugins/artist-runtime/api/platforms");
  if (!handler) {
    throw new Error("platform route not registered");
  }
  return handler;
}

async function runProbe(platform: "x" | "instagram" | "tiktok", workspaceRoot: string) {
  const response = createMockResponse();
  await platformRoute()(
    createMockRequest(
      "POST",
      `/plugins/artist-runtime/api/platforms/${platform}/test`,
      JSON.stringify({ config: { artist: { workspaceRoot } } }),
      { "content-type": "application/json" }
    ),
    response.res
  );
  return JSON.parse(response.readBody()) as { status: { authStatus?: string; lastTestedAt?: number } };
}

describe("platform auth status persistence", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("persists tested authStatus after a successful X probe", async () => {
    const root = mkdtempSync(join(tmpdir(), "platform-auth-x-"));
    await ensureArtistWorkspace(root);
    spawnMock.mockImplementation(createSpawnMock([
      { code: 0, stdout: "bird help" },
      { code: 0, stdout: "@ghost_station" }
    ]));

    const result = await runProbe("x", root);
    const config = await readResolvedConfig(root);

    expect(result.status.authStatus).toBe("tested");
    expect(config.distribution.platforms.x.authStatus).toBe("tested");
    expect(config.distribution.platforms.x.lastTestedAt).toBeTypeOf("number");
  });

  it("persists failed authStatus after an Instagram auth miss", async () => {
    const root = mkdtempSync(join(tmpdir(), "platform-auth-ig-"));
    await ensureArtistWorkspace(root);
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "");
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "");

    const result = await runProbe("instagram", root);
    const config = await readResolvedConfig(root);

    expect(result.status.authStatus).toBe("failed");
    expect(config.distribution.platforms.instagram.authStatus).toBe("failed");
    expect(config.distribution.platforms.instagram.lastTestedAt).toBeTypeOf("number");
  });

  it("keeps TikTok authStatus unconfigured even when patched otherwise", async () => {
    const root = mkdtempSync(join(tmpdir(), "platform-auth-tiktok-"));
    await ensureArtistWorkspace(root);
    await patchResolvedConfig(root, {
      distribution: {
        platforms: {
          tiktok: { authStatus: "tested", lastTestedAt: Date.now(), liveGoArmed: true }
        }
      } as unknown as Partial<ArtistRuntimeConfig>["distribution"]
    });

    const result = await runProbe("tiktok", root);
    const config = await readResolvedConfig(root);

    expect(result.status.authStatus).toBe("unconfigured");
    expect(config.distribution.platforms.tiktok.authStatus).toBe("unconfigured");
    expect(config.distribution.platforms.tiktok.liveGoArmed).toBe(false);
    expect(config.distribution.platforms.tiktok.lastTestedAt).toBeUndefined();
  });

  it("validates authStatus and tested-at fields", () => {
    const future = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const invalid = validateConfig({
      distribution: {
        platforms: {
          x: {
            authStatus: "done",
            lastTestedAt: future
          }
        }
      }
    });

    expect(invalid.ok).toBe(false);
    expect(invalid.errors).toContain("config.distribution.platforms.x.authStatus must be one of unconfigured, configured, tested, failed");
    expect(invalid.errors).toContain("config.distribution.platforms.x.lastTestedAt must be an integer between 0 and now+1d");
  });

  it("surfaces Instagram token expiry warnings inside platform status", async () => {
    const root = mkdtempSync(join(tmpdir(), "platform-auth-ig-expiry-"));
    await ensureArtistWorkspace(root);
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "configured-token");

    const status = await buildPlatformDetailResponse("instagram", {
      artist: { workspaceRoot: root },
      distribution: {
        platforms: {
          instagram: {
            accessTokenExpiresAt: Date.now() + 10 * 24 * 60 * 60 * 1000
          }
        }
      } as unknown as Partial<ArtistRuntimeConfig>["distribution"]
    });

    expect(status.instagramTokenExpiringSoon).toBe(true);
  });
});
