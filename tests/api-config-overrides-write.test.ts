import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConfigOverridesResponse, buildStatusResponse, registerRoutes } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { writeRuntimeSafetyOverrides } from "../src/services/runtimeConfig";

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
    json: () => JSON.parse(body) as Record<string, unknown>,
    readStatus: () => (res as unknown as { statusCode: number }).statusCode
  };
}

function registerOverridesHandler() {
  const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      registered.set(definition.path, definition.handler);
    }
  });
  const handler = registered.get("/plugins/artist-runtime/api/config/overrides");
  if (!handler) {
    throw new Error("config overrides route not registered");
  }
  return handler;
}

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void,
  method: string,
  root: string,
  payload: Record<string, unknown> = {}
) {
  const response = createMockResponse();
  await handler(
    createMockRequest(
      method,
      "/plugins/artist-runtime/api/config/overrides",
      JSON.stringify({ ...payload, config: { artist: { workspaceRoot: root } } }),
      { "content-type": "application/json" }
    ),
    response.res
  );
  return response;
}

describe("config overrides route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports default and existing effective runtime safety values", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-api-overrides-get-"));
    await ensureArtistWorkspace(root);

    let response = await buildConfigOverridesResponse({ artist: { workspaceRoot: root } });
    expect(response.values.birdDailyMax).toMatchObject({ value: 5, source: "default" });
    expect(response.values.birdMinIntervalMinutes).toMatchObject({ value: 60, source: "default" });

    await writeRuntimeSafetyOverrides(root, {
      bird: { rateLimits: { dailyMax: 4, minIntervalMinutes: 120 } }
    });
    response = await buildConfigOverridesResponse({ artist: { workspaceRoot: root } });
    expect(response.values.birdDailyMax).toMatchObject({ value: 4, source: "overrides" });
    expect(response.values.birdMinIntervalMinutes).toMatchObject({ value: 120, source: "overrides" });
  });

  it("writes valid Bird overrides and records audit", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-api-overrides-post-"));
    await ensureArtistWorkspace(root);
    const handler = registerOverridesHandler();

    const response = await invoke(handler, "POST", root, {
      bird: { rateLimits: { dailyMax: 6, minIntervalMinutes: 75 } }
    });

    expect(response.readStatus()).toBe(200);
    expect(response.json()).toMatchObject({
      values: {
        birdDailyMax: { value: 6, source: "overrides" },
        birdMinIntervalMinutes: { value: 75, source: "overrides" }
      }
    });
    const auditText = readFileSync(join(root, "runtime", "config-overrides-audit.jsonl"), "utf8");
    expect(auditText).toContain("config_overrides_update");
    expect(auditText).toContain("\"actor\":\"producer\"");
  });

  it("rejects non-whitelisted and invalid override payloads", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-api-overrides-invalid-"));
    await ensureArtistWorkspace(root);
    const handler = registerOverridesHandler();

    let response = await invoke(handler, "POST", root, {
      music: { suno: { dailyCreditLimit: 999 } }
    });
    expect(response.json()).toMatchObject({
      error: "invalid_config_overrides",
      statusCode: 400
    });
    expect((response.json().errors as string[]).join(" ")).toContain("unknown override key: music");

    response = await invoke(handler, "POST", root, {
      suno: { dailyBudget: 80 }
    });
    expect(response.json()).toMatchObject({
      error: "invalid_config_overrides",
      statusCode: 400
    });
    expect((response.json().errors as string[]).join(" ")).toContain("unknown override key: suno");
  });

  it("ignores stale Suno dailyBudget overrides without crashing", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-api-overrides-env-"));
    await ensureArtistWorkspace(root);
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(join(root, "runtime", "config-overrides.json"), JSON.stringify({ suno: { dailyBudget: 12 } }), "utf8");

    const response = await buildConfigOverridesResponse({ artist: { workspaceRoot: root } });
    const status = await buildStatusResponse({ artist: { workspaceRoot: root } });

    expect(response.raw).toMatchObject({ suno: { dailyBudget: 12 } });
    expect(response.values).not.toHaveProperty("sunoDailyBudget");
    expect(status.suno.budget.limit).toBe(60);
  });
});
