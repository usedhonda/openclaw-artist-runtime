import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRoutes } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";

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
      if (step.errorCode) {
        const error = new Error(step.errorCode) as NodeJS.ErrnoException;
        error.code = step.errorCode;
        child.emit("error", error);
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

async function runPlatformProbe(platform: "x" | "instagram" | "tiktok", workspaceRoot: string) {
  const handler = registeredRouteHandlers().get("/plugins/artist-runtime/api/platforms");
  expect(handler).toBeTruthy();
  const response = createMockResponse();

  await handler?.(
    createMockRequest(
      "POST",
      `/plugins/artist-runtime/api/platforms/${platform}/test`,
      JSON.stringify({
        config: {
          artist: {
            workspaceRoot
          }
        }
      }),
      { "content-type": "application/json" }
    ),
    response.res
  );

  expect(response.readStatus()).toBe(200);
  expect(response.readHeader("content-type")).toContain("application/json");
  return JSON.parse(response.readBody()) as {
    platform: string;
    testedAt: string;
    status: {
      connected: boolean;
      reason?: string;
      accountLabel?: string;
    };
  };
}

describe("platform probe route wiring", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns connected from /api/platforms/x/test when Bird whoami succeeds", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-platform-x-probe-"));
    await ensureArtistWorkspace(workspaceRoot);
    spawnMock.mockImplementation(createSpawnMock([
      { code: 0, stdout: "bird help" },
      { code: 0, stdout: "@ghost_station" }
    ]));

    const result = await runPlatformProbe("x", workspaceRoot);
    expect(result).toMatchObject({
      platform: "x",
      status: {
        connected: true,
        accountLabel: "@ghost_station"
      }
    });
  });

  it("returns instagram_auth_not_configured from /api/platforms/instagram/test without env", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-platform-instagram-probe-"));
    await ensureArtistWorkspace(workspaceRoot);
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "");
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());

    const result = await runPlatformProbe("instagram", workspaceRoot);
    expect(result).toMatchObject({
      platform: "instagram",
      status: {
        connected: false,
        reason: "instagram_auth_not_configured"
      }
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns connected from /api/platforms/instagram/test when env is present", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-platform-instagram-connected-"));
    await ensureArtistWorkspace(workspaceRoot);
    vi.stubEnv("OPENCLAW_INSTAGRAM_AUTH", "configured-token");
    vi.stubEnv("OPENCLAW_INSTAGRAM_ACCESS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());

    const result = await runPlatformProbe("instagram", workspaceRoot);
    expect(result).toMatchObject({
      platform: "instagram",
      status: {
        connected: true,
        accountLabel: "configured_via_env"
      }
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns account_not_created from /api/platforms/tiktok/test without env", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-platform-tiktok-probe-"));
    await ensureArtistWorkspace(workspaceRoot);
    vi.stubEnv("OPENCLAW_TIKTOK_AUTH", "");
    vi.stubEnv("OPENCLAW_TIKTOK_ACCESS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());

    const result = await runPlatformProbe("tiktok", workspaceRoot);
    expect(result).toMatchObject({
      platform: "tiktok",
      status: {
        connected: false,
        reason: "account_not_created"
      }
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps tiktok frozen even when auth env is present", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "artist-runtime-platform-tiktok-frozen-"));
    await ensureArtistWorkspace(workspaceRoot);
    vi.stubEnv("OPENCLAW_TIKTOK_AUTH", "token-present");
    vi.stubEnv("OPENCLAW_TIKTOK_ACCESS_TOKEN", "access-token-present");
    vi.stubGlobal("fetch", vi.fn());

    const result = await runPlatformProbe("tiktok", workspaceRoot);
    expect(result).toMatchObject({
      platform: "tiktok",
      status: {
        connected: false,
        reason: "account_not_created"
      }
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
