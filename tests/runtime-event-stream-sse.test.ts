import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes";
import {
  createRuntimeEventStreamHandler,
  runtimeEventStreamPath,
  serializeRuntimeEventForSse
} from "../src/routes/runtimeEventStream";
import { emitRuntimeEvent, getRuntimeEventBus } from "../src/services/runtimeEventBus";
import { mergeRuntimeActionEvents, parseRuntimeActionMirrorEvent } from "../ui/src/components/RuntimeActionMirrorCard";

class FakeRequest extends EventEmitter {
  method = "GET";
  url = runtimeEventStreamPath;
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  readonly headers = new Map<string, string | number | string[]>();
  readonly chunks: string[] = [];

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name, Array.isArray(value) ? [...value] : value);
    return this;
  }

  write(chunk: string | Buffer) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
    return true;
  }

  end(chunk?: string | Buffer) {
    if (chunk) {
      this.write(chunk);
    }
    this.headersSent = true;
    this.emit("close");
    return this;
  }
}

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runtime event SSE stream", () => {
  it("registers the SSE endpoint and writes stream headers", async () => {
    const routes = new Map<string, { handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }>();
    registerRoutes({
      registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
        routes.set(definition.path, definition);
      }
    });
    expect(routes.has(runtimeEventStreamPath)).toBe(true);

    const req = new FakeRequest();
    const res = new FakeResponse();
    await routes.get(runtimeEventStreamPath)?.handler(req as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Connection")).toBe("keep-alive");
    req.emit("close");
  });

  it("pushes runtime events to the SSE client and parses them for the UI mirror", async () => {
    getRuntimeEventBus().clearForTest();
    const req = new FakeRequest();
    const res = new FakeResponse();
    await createRuntimeEventStreamHandler({ heartbeatMs: 10_000 })(req as IncomingMessage, res as unknown as ServerResponse);

    emitRuntimeEvent({
      type: "distribution_change_detected",
      songId: "where-it-played",
      platform: "spotify",
      url: "https://open.spotify.com/track/test",
      proposalId: "proposal-1",
      timestamp: 1777400000000
    });
    await wait();

    const eventChunk = res.chunks.find((chunk) => chunk.startsWith("data: "));
    expect(eventChunk).toBeTruthy();
    const parsed = parseRuntimeActionMirrorEvent(eventChunk?.replace(/^data: /, "").trim() ?? "");
    expect(parsed).toMatchObject({ type: "distribution_change_detected", proposalId: "proposal-1" });
    expect(mergeRuntimeActionEvents([parsed], [], "distribution")).toHaveLength(1);
    req.emit("close");
  });

  it("sends heartbeat comments and unsubscribes on disconnect", async () => {
    getRuntimeEventBus().clearForTest();
    const req = new FakeRequest();
    const res = new FakeResponse();
    await createRuntimeEventStreamHandler({ heartbeatMs: 5 })(req as IncomingMessage, res as unknown as ServerResponse);
    await wait(12);
    expect(res.chunks.some((chunk) => chunk === ":hb\n\n")).toBe(true);

    req.emit("close");
    const before = res.chunks.length;
    emitRuntimeEvent({ type: "song_take_completed", songId: "song-1", urls: [], timestamp: 1777400000001 });
    await wait();
    expect(res.chunks).toHaveLength(before);
  });

  it("filters secret-like payloads before serializing", () => {
    const safe = serializeRuntimeEventForSse({ type: "song_take_completed", songId: "song-1", urls: [], timestamp: 1 });
    const blocked = serializeRuntimeEventForSse({
      type: "error",
      source: "test",
      reason: "SECRET=do-not-stream",
      timestamp: 1
    });
    expect(safe).toContain("song_take_completed");
    expect(blocked).toBeUndefined();
  });
});
