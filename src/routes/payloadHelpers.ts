import type { ObservabilityExportWindow, SocialPlatform } from "../types.js";

export function payloadRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

export function normalizeRequestPath(path: string): string {
  if (path === "/") {
    return path;
  }
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

export function payloadRequestPath(payload: Record<string, unknown>, fallback: string): string {
  return typeof payload.requestPath === "string" ? normalizeRequestPath(payload.requestPath) : fallback;
}

export function payloadRequestMethod(payload: Record<string, unknown>, fallback: "GET" | "POST" | "PATCH" = "GET"): "GET" | "POST" | "PATCH" {
  const method = typeof payload.requestMethod === "string" ? payload.requestMethod.toUpperCase() : fallback;
  return method === "POST" || method === "PATCH" ? method : "GET";
}

export function payloadPathSegments(payload: Record<string, unknown>, prefix: string): string[] {
  const normalizedPrefix = normalizeRequestPath(prefix);
  const requestPath = payloadRequestPath(payload, normalizedPrefix);
  if (requestPath === normalizedPrefix) {
    return [];
  }
  if (!requestPath.startsWith(`${normalizedPrefix}/`)) {
    return [];
  }
  return requestPath
    .slice(normalizedPrefix.length + 1)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

export function platformFromSegment(value: unknown): SocialPlatform | undefined {
  return value === "instagram" || value === "tiktok" || value === "x" ? value : undefined;
}

export function exportWindowFromInput(value: unknown): ObservabilityExportWindow {
  return value === "30d" || value === "all" ? value : "7d";
}

export function exportWindowFromPayload(payload: Record<string, unknown>): ObservabilityExportWindow {
  if (typeof payload.window === "string") {
    return exportWindowFromInput(payload.window);
  }
  const requestPath = payloadRequestPath(payload, "/plugins/artist-runtime/api/status/export");
  const queryIndex = requestPath.indexOf("?");
  if (queryIndex < 0) {
    return "7d";
  }
  return exportWindowFromInput(new URLSearchParams(requestPath.slice(queryIndex + 1)).get("window"));
}

export function payloadInteger(payload: Record<string, unknown>, key: string, fallback: number): number {
  const value = payload[key];
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function queryValueFromPayload(payload: Record<string, unknown>, key: string, routePath: string): string | undefined {
  const direct = payload[key];
  if (typeof direct === "string") {
    return direct;
  }
  const requestPath = payloadRequestPath(payload, routePath);
  const queryIndex = requestPath.indexOf("?");
  if (queryIndex < 0) {
    return undefined;
  }
  return new URLSearchParams(requestPath.slice(queryIndex + 1)).get(key) ?? undefined;
}

export function integerFromPayloadOrQuery(payload: Record<string, unknown>, key: string, fallback: number, routePath: string): number {
  const direct = payloadInteger(payload, key, Number.NaN);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const queryValue = queryValueFromPayload(payload, key, routePath);
  const parsed = queryValue ? Number.parseInt(queryValue, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalInteger(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export function isLocalRoutePayload(payload: Record<string, unknown>): boolean {
  const remote = typeof payload.remoteAddress === "string" ? payload.remoteAddress.trim() : "";
  return remote === "" || remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

export function sunoDiagnosticsDaysFromPayload(payload: Record<string, unknown>): number {
  return Math.min(30, Math.max(1, payloadInteger(payload, "days", 7)));
}
