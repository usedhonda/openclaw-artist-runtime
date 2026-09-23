import type { IncomingMessage, ServerResponse } from "node:http";
import { secretLikePattern } from "../services/personaMigrator.js";
import { getRuntimeEventBus, type RuntimeEvent } from "../services/runtimeEventBus.js";

export const runtimeEventStreamPath = "/plugins/artist-runtime/api/events/stream";

interface RuntimeEventStreamOptions {
  heartbeatMs?: number;
}

interface RuntimeEventStreamApi {
  registerHttpRoute?: (route: {
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
    auth?: "plugin" | "gateway";
    match?: "exact" | "prefix";
  }) => void;
}

function asRuntimeEventStreamApi(api: unknown): RuntimeEventStreamApi {
  return typeof api === "object" && api !== null ? api as RuntimeEventStreamApi : {};
}

export function serializeRuntimeEventForSse(event: RuntimeEvent): string | undefined {
  const payload = JSON.stringify(event);
  return secretLikePattern.test(payload) ? undefined : payload;
}

export function createRuntimeEventStreamHandler(options: RuntimeEventStreamOptions = {}) {
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if ((req.method ?? "GET").toUpperCase() !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(":open\n\n");

    const unsubscribe = getRuntimeEventBus().subscribe((event) => {
      const payload = serializeRuntimeEventForSse(event);
      if (!payload) {
        return;
      }
      res.write(`data: ${payload}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(":hb\n\n");
    }, heartbeatMs);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.once("close", cleanup);
    res.once("close", cleanup);
    return true;
  };
}

export function registerRuntimeEventStreamRoute(api: unknown): void {
  asRuntimeEventStreamApi(api).registerHttpRoute?.({
    path: runtimeEventStreamPath,
    handler: createRuntimeEventStreamHandler(),
    auth: "plugin",
    match: "exact"
  });
}
