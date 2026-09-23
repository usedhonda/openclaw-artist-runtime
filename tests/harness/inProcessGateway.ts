import { mkdtemp } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { rm } from "node:fs/promises";
import { registerRoutes } from "../../src/routes/index.js";
import { ensureArtistWorkspace } from "../../src/services/artistWorkspace.js";
import type { ArtistRuntimeConfig } from "../../src/types.js";

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;

interface RegisteredRoute {
  path: string;
  match?: "exact" | "prefix";
  handler: RouteHandler;
}

export interface InProcessGatewayResponse<T = unknown> {
  statusCode: number;
  bodyText: string;
  body: T;
}

export interface InProcessGateway {
  workspaceRoot: string;
  request<T = unknown>(method: "GET" | "POST" | "PATCH", path: string, body?: Record<string, unknown>): Promise<InProcessGatewayResponse<T>>;
  teardown(options?: { removeWorkspace?: boolean }): Promise<void>;
}

function createMockRequest(method: string, url: string, body?: string): IncomingMessage {
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = body ? { "content-type": "application/json" } : {};
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

function registeredRoutes(): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  registerRoutes({
    registerHttpRoute(definition: RegisteredRoute) {
      routes.push(definition);
    }
  });
  return routes;
}

function requestPath(path: string): string {
  return new URL(path, "http://127.0.0.1").pathname.replace(/\/+$/, "") || "/";
}

function routeMatches(route: RegisteredRoute, path: string): boolean {
  const routePath = route.path.replace(/\/+$/, "") || "/";
  if (route.match === "prefix") {
    return path === routePath || path.startsWith(`${routePath}/`);
  }
  return path === routePath;
}

function findRoute(routes: RegisteredRoute[], path: string): RegisteredRoute {
  const normalized = requestPath(path);
  const route = routes.find((candidate) => routeMatches(candidate, normalized));
  if (!route) {
    throw new Error(`in-process gateway route not found: ${path}`);
  }
  return route;
}

function withWorkspaceConfig(
  workspaceRoot: string,
  body: Record<string, unknown> | undefined
): Record<string, unknown> {
  const base = body ?? {};
  const config = (typeof base.config === "object" && base.config !== null ? base.config : {}) as Partial<ArtistRuntimeConfig>;
  return {
    ...base,
    config: {
      ...config,
      artist: {
        ...(config.artist ?? {}),
        workspaceRoot
      }
    }
  };
}

export async function createInProcessGateway(options: { workspaceRoot?: string } = {}): Promise<InProcessGateway> {
  const workspaceRoot = options.workspaceRoot ?? await mkdtemp(join(tmpdir(), "artist-runtime-gateway-"));
  await ensureArtistWorkspace(workspaceRoot);
  const routes = registeredRoutes();

  return {
    workspaceRoot,
    async request<T = unknown>(method, path, body) {
      const route = findRoute(routes, path);
      const response = createMockResponse();
      const payload = JSON.stringify(withWorkspaceConfig(workspaceRoot, body));
      await route.handler(createMockRequest(method, path, payload), response.res);
      const bodyText = response.readBody();
      return {
        statusCode: response.res.statusCode,
        bodyText,
        body: bodyText ? JSON.parse(bodyText) as T : undefined as T
      };
    },
    async teardown(teardownOptions = {}) {
      if (teardownOptions.removeWorkspace === false) {
        return;
      }
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  };
}
