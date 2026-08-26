import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRoutes } from "../src/routes";
import { ArtistAutopilotService } from "../src/services/autopilotService";
import { resetAutopilotTickerForTest } from "../src/services/autopilotTicker";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import type { AutopilotRunState } from "../src/types";

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

  return {
    res,
    readBody: () => body,
    readStatus: () => (res as unknown as { statusCode: number }).statusCode
  };
}

function state(): AutopilotRunState {
  return {
    stage: "planning",
    paused: false,
    retryCount: 0,
    cycleCount: 1,
    updatedAt: "2026-04-29T01:00:00.000Z"
  };
}

describe("run-cycle route manual seed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAutopilotTickerForTest();
  });

  it("passes manualSeed hint into autopilotService.runCycle", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-run-cycle-hint-"));
    await ensureArtistWorkspace(root);
    const spy = vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockResolvedValue(state());
    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/run-cycle");
    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/run-cycle",
        JSON.stringify({
          config: { artist: { workspaceRoot: root }, autopilot: { enabled: false, dryRun: true } },
          manualSeed: { hint: "latest rail noise" }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(JSON.parse(response.readBody())).toMatchObject({ tickerOutcome: "ran" });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: root,
      manualSeed: { hint: "latest rail noise" }
    }));
  });

  it("keeps no-hint run-cycle behavior", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-run-cycle-no-hint-"));
    await ensureArtistWorkspace(root);
    const spy = vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockResolvedValue(state());
    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/run-cycle");
    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/run-cycle",
        JSON.stringify({ config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } } }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.not.objectContaining({ manualSeed: expect.anything() }));
  });

  it("passes an explicit producer-requested spawn flag", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-run-cycle-operator-spawn-"));
    await ensureArtistWorkspace(root);
    const spy = vi.spyOn(ArtistAutopilotService.prototype, "runCycle").mockResolvedValue(state());
    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/run-cycle");
    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/run-cycle",
        JSON.stringify({
          config: { artist: { workspaceRoot: root }, autopilot: { enabled: true, dryRun: true } },
          operatorRequestedSpawn: true
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    expect(response.readStatus()).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: root,
      operatorRequestedSpawn: true
    }));
  });
});
