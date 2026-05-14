import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";

type UnknownHandler = (payload?: unknown) => unknown | Promise<unknown>;
type HttpMethod = "GET" | "POST" | "PATCH";

export interface ToolRegistration {
  name: string;
  handler: UnknownHandler;
}

export interface HookRegistration {
  event: string;
  handler: UnknownHandler;
}

export interface ServiceRegistration {
  name: string;
  create: () => unknown;
}

export interface CommandRegistration {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  nativeNames?: Partial<Record<string, string>> & { default?: string };
  nativeProgressMessages?: Partial<Record<string, string>> & { default?: string };
  handler: UnknownHandler;
}

export interface RouteRegistration {
  method: HttpMethod | HttpMethod[];
  path: string;
  handler: UnknownHandler;
  auth?: "plugin" | "gateway";
  match?: "exact" | "prefix";
  contentType?: string;
}

export interface InteractiveHandlerRegistration {
  channel: string;
  namespace: string;
  handler: UnknownHandler;
}

export interface PluginApiLike {
  registerTool?: (tool: ToolRegistration, opts?: { name?: string; names?: string[]; optional?: boolean }) => void;
  registerHook?: (events: string | string[], handler: UnknownHandler, opts?: { name?: string; description?: string; register?: boolean }) => void;
  registerService?: (service: { id?: string; name?: string; start?: UnknownHandler; stop?: UnknownHandler }) => void;
  registerCommand?: (command: CommandRegistration) => void;
  registerInteractiveHandler?: (registration: InteractiveHandlerRegistration) => void;
  getPluginCommandSpecs?: (provider?: string) => Array<{ name: string; description?: string; acceptsArgs?: boolean }>;
  registerHttpRoute?: (route: {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
    auth?: "plugin" | "gateway";
    match?: "exact" | "prefix";
  }) => void;
}

function asPluginApi(api: unknown): PluginApiLike {
  return typeof api === "object" && api !== null ? (api as PluginApiLike) : {};
}

function normalizePath(path: string): string {
  if (path === "/") {
    return path;
  }
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

function extractPathParams(routePath: string, requestPath: string): Record<string, string> {
  const routeSegments = normalizePath(routePath).split("/").filter(Boolean);
  const requestSegments = normalizePath(requestPath).split("/").filter(Boolean);
  if (routeSegments.length !== requestSegments.length) {
    return {};
  }

  const params: Record<string, string> = {};
  for (const [index, routeSegment] of routeSegments.entries()) {
    if (!routeSegment.startsWith(":")) {
      continue;
    }
    const rawValue = requestSegments[index] ?? "";
    params[routeSegment.slice(1)] = decodeURIComponent(rawValue);
  }
  return params;
}

function readQueryParams(url: URL): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = params[key];
    if (existing === undefined) {
      params[key] = value;
      continue;
    }
    params[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return params;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBodyPayload(bodyText: string, contentType: string | undefined): unknown {
  if (!bodyText.trim()) {
    return undefined;
  }
  if (contentType?.includes("application/json")) {
    return JSON.parse(bodyText) as unknown;
  }
  return bodyText;
}

function mergeRoutePayload(base: Record<string, unknown>, bodyPayload: unknown): Record<string, unknown> {
  if (bodyPayload === undefined) {
    return base;
  }
  if (typeof bodyPayload === "object" && bodyPayload !== null && !Array.isArray(bodyPayload)) {
    return { ...base, ...(bodyPayload as Record<string, unknown>) };
  }
  return { ...base, body: bodyPayload };
}

function inferContentType(route: RouteRegistration, result: unknown): string {
  if (route.contentType) {
    return route.contentType;
  }
  if (typeof result === "string") {
    return route.path.includes("/api/") ? "text/plain; charset=utf-8" : "text/html; charset=utf-8";
  }
  return "application/json; charset=utf-8";
}

function writeRouteResponse(res: ServerResponse, route: RouteRegistration, result: unknown): void {
  if (res.headersSent) {
    return;
  }

  const contentType = inferContentType(route, result);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  if (result === undefined) {
    res.end(contentType.includes("application/json") ? "{}" : "");
    return;
  }
  if (typeof result === "string") {
    res.end(result);
    return;
  }
  res.end(JSON.stringify(result));
}

function createHttpRouteHandler(route: RouteRegistration) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const method = (req.method ?? "GET").toUpperCase();
    const allowedMethods = Array.isArray(route.method) ? route.method : [route.method];
    if (!allowedMethods.includes(method as HttpMethod)) {
      res.statusCode = 405;
      res.setHeader("Allow", allowedMethods.join(", "));
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`Method ${method} Not Allowed`);
      return true;
    }

    const url = new URL(req.url ?? route.path, "http://127.0.0.1");
    const payloadBase: Record<string, unknown> = {
      requestMethod: method,
      requestPath: url.pathname,
      ...readQueryParams(url),
      ...extractPathParams(route.path, url.pathname)
    };
    const bodyText = await readRequestBody(req);
    const bodyPayload = parseBodyPayload(bodyText, typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined);
    const mergedPayload = mergeRoutePayload(payloadBase, bodyPayload);
    const payload = route.path.endsWith("/api/telegram/callback-dispatch")
      ? { ...mergedPayload, remoteAddress: req.socket?.remoteAddress }
      : mergedPayload;
    const result = await route.handler(payload);
    writeRouteResponse(res, route, result);
    return true;
  };
}

export function safeRegisterTool(api: unknown, tool: ToolRegistration): void {
  asPluginApi(api).registerTool?.(tool, { name: tool.name });
}

export function safeRegisterHook(api: unknown, hook: HookRegistration): void {
  const registerHook = asPluginApi(api).registerHook;
  if (!registerHook) {
    return;
  }
  registerHook(hook.event, hook.handler, { name: hook.event });
}

export function safeRegisterService(api: unknown, service: ServiceRegistration): void {
  asPluginApi(api).registerService?.({
    id: service.name,
    start: async () => {
      const instance = service.create();
      if (typeof instance === "object" && instance !== null && "start" in instance && typeof (instance as { start?: UnknownHandler }).start === "function") {
        return (instance as { start: UnknownHandler }).start();
      }
      return instance;
    },
    stop: async () => {
      const instance = service.create();
      if (typeof instance === "object" && instance !== null && "stop" in instance && typeof (instance as { stop?: UnknownHandler }).stop === "function") {
        return (instance as { stop: UnknownHandler }).stop();
      }
      return undefined;
    }
  });
}

export function safeRegisterCommand(
  api: unknown,
  command: CommandRegistration,
  onResult?: (ok: boolean, name: string) => void
): void {
  const registerCommand = asPluginApi(api).registerCommand;
  const ok = typeof registerCommand === "function";
  if (ok) {
    registerCommand(command);
  }
  onResult?.(ok, command.name);
}

export function safeRegisterInteractiveHandler(api: unknown, registration: InteractiveHandlerRegistration): void {
  asPluginApi(api).registerInteractiveHandler?.(registration);
}

export function safeRegisterRoute(api: unknown, route: RouteRegistration): void {
  asPluginApi(api).registerHttpRoute?.({
    path: route.path,
    handler: createHttpRouteHandler(route),
    auth: route.auth ?? "plugin",
    match: route.match
  });
}
