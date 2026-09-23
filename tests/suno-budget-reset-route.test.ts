import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
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

describe("Suno budget reset route", () => {
  it("resets persisted daily budget state through the Suno route family", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-suno-budget-reset-route-"));
    mkdirSync(join(root, "runtime", "suno"), { recursive: true });
    writeFileSync(
      join(root, "runtime", "suno", "budget.json"),
      `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), consumed: 45 }, null, 2)}\n`,
      "utf8"
    );

    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        registered.set(definition.path, definition.handler);
      }
    });

    const handler = registered.get("/plugins/artist-runtime/api/suno");
    expect(handler).toBeTruthy();

    const response = createMockResponse();
    await handler?.(
      createMockRequest(
        "POST",
        "/plugins/artist-runtime/api/suno/budget/reset",
        JSON.stringify({
          config: {
            artist: { workspaceRoot: root },
            music: { suno: { dailyCreditLimit: 120 } }
          }
        }),
        { "content-type": "application/json" }
      ),
      response.res
    );

    const persisted = JSON.parse(readFileSync(join(root, "runtime", "suno", "budget.json"), "utf8")) as {
      date: string;
      consumed: number;
    };

    expect(response.readStatus()).toBe(200);
    expect(response.readHeader("content-type")).toContain("application/json");
    expect(JSON.parse(response.readBody())).toMatchObject({
      consumed: 0,
      limit: 120,
      remaining: 120,
      lastResetAt: expect.any(String),
      monthly: {
        limit: 0,
        unlimited: true
      }
    });
    expect(persisted.consumed).toBe(0);
  });
});
