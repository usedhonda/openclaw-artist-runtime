import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

// Keep the suno_cli connect route off the real browser: the probe driver is stubbed so
// connect/reconnect resolve login state without launching Chromium.
vi.mock("../src/services/sunoBrowserServiceDriver", () => ({
  SunoBrowserServiceProbeDriver: class {
    async probe() {
      return { state: "login_required", detail: "stubbed probe" };
    }
    async stop() {
      return undefined;
    }
  }
}));

import { registerRoutes } from "../src/routes";

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

function sunoHandler() {
  const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      registered.set(definition.path, definition.handler);
    }
  });
  const handler = registered.get("/plugins/artist-runtime/api/suno");
  expect(handler).toBeTruthy();
  return handler!;
}

async function postConnect(driver: string, path = "connect"): Promise<unknown> {
  const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-connect-driver-"));
  const handler = sunoHandler();
  const response = createMockResponse();
  await handler(
    createMockRequest(
      "POST",
      `/plugins/artist-runtime/api/suno/${path}`,
      JSON.stringify({ config: { artist: { workspaceRoot: root }, music: { suno: { driver } } } }),
      { "content-type": "application/json" }
    ),
    response.res
  );
  return JSON.parse(response.readBody());
}

describe("Suno connect/handoff driver-awareness", () => {
  it.each(["connect", "reconnect", "handoff/complete"])(
    "routes %s through the browser-service worker flow under the suno_cli driver (no diagnostic no-op)",
    async (action) => {
      const body = (await postConnect("suno_cli", action)) as Record<string, unknown>;
      expect(body.error).not.toBe("suno_cli_driver_no_browser_handoff");
      // A real worker status carries a `state` field; the old diagnostic no-op did not.
      expect(body).toHaveProperty("state");
    }
  );

  it("opens the browser and reports login_required for a suno_cli connect", async () => {
    const body = (await postConnect("suno_cli", "connect")) as Record<string, unknown>;
    expect(body.state).toBe("login_required");
  });

  it("marks connected on a suno_cli handoff completion", async () => {
    const body = (await postConnect("suno_cli", "handoff/complete")) as Record<string, unknown>;
    expect(body.state).toBe("connected");
    expect(body.connected).toBe(true);
  });

  it("preserves browser-worker connect behavior for the playwright driver", async () => {
    const body = (await postConnect("playwright")) as Record<string, unknown>;
    expect(body.error).not.toBe("suno_cli_driver_no_browser_handoff");
    // A real worker status carries a `state` field; the diagnostic no-op did not.
    expect(body).toHaveProperty("state");
  });
});
