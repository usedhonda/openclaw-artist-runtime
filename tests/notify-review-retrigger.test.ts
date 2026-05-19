import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import { readSongState, updateSongState } from "../src/services/artistState";
import { getRuntimeEventBus, type RuntimeEvent } from "../src/services/runtimeEventBus";

function createMockRequest(method: string, url: string, body?: string): IncomingMessage {
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = { "content-type": "application/json" };
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

function registerSongsHandler() {
  const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      registered.set(definition.path, definition.handler);
    }
  });
  const handler = registered.get("/plugins/artist-runtime/api/songs");
  if (!handler) {
    throw new Error("songs route not registered");
  }
  return handler;
}

async function prepareWorkspace(status: "take_selected" | "brief" = "take_selected"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artist-runtime-notify-review-"));
  await ensureArtistWorkspace(root);
  await updateSongState(root, "song-018", {
    title: "Pika Pika Floor",
    status,
    selectedTakeId: status === "take_selected" ? "take-1" : undefined,
    replacePublicLinks: status === "take_selected" ? ["https://suno.com/song/take-1"] : []
  });
  return root;
}

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void,
  root: string
) {
  const response = createMockResponse();
  await handler(
    createMockRequest(
      "POST",
      "/plugins/artist-runtime/api/songs/song-018/notify-review",
      JSON.stringify({ config: { artist: { workspaceRoot: root } } })
    ),
    response.res
  );
  return response;
}

afterEach(() => {
  delete process.env.OPENCLAW_DEBUG_NOTIFY_REVIEW;
  getRuntimeEventBus().clearForTest();
});

describe("notify-review retrigger endpoint", () => {
  it("rejects when OPENCLAW_DEBUG_NOTIFY_REVIEW is off", async () => {
    const root = await prepareWorkspace();
    const handler = registerSongsHandler();
    process.env.OPENCLAW_DEBUG_NOTIFY_REVIEW = "off";

    const response = await invoke(handler, root);

    expect(response.readStatus()).toBe(200);
    expect(response.json()).toMatchObject({
      notified: false,
      songId: "song-018",
      reason: "debug_notify_review_disabled",
      statusCode: 403
    });
  });

  it("rejects songs that are not in take_selected", async () => {
    const root = await prepareWorkspace("brief");
    const handler = registerSongsHandler();
    process.env.OPENCLAW_DEBUG_NOTIFY_REVIEW = "on";

    const response = await invoke(handler, root);

    expect(response.readStatus()).toBe(200);
    expect(response.json()).toMatchObject({
      notified: false,
      songId: "song-018",
      reason: "song_not_in_take_selected",
      statusCode: 400
    });
  });

  it("re-emits song_take_completed and writes callback audit without mutating song state", async () => {
    const root = await prepareWorkspace();
    const handler = registerSongsHandler();
    const events: RuntimeEvent[] = [];
    const unsubscribe = getRuntimeEventBus().subscribe((event) => events.push(event));
    process.env.OPENCLAW_DEBUG_NOTIFY_REVIEW = "on";

    const response = await invoke(handler, root);
    unsubscribe();

    expect(response.readStatus()).toBe(200);
    expect(response.json()).toMatchObject({
      notified: true,
      songId: "song-018",
      selectedTakeId: "take-1",
      eventType: "song_take_completed",
      reason: "notify_review_retriggered",
      statusCode: 200
    });
    expect(await readSongState(root, "song-018")).toMatchObject({
      status: "take_selected",
      selectedTakeId: "take-1"
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "song_take_completed",
      songId: "song-018",
      selectedTakeId: "take-1",
      urls: ["https://suno.com/song/take-1"],
      actor: "manual_notify_retrigger"
    }));
    const audit = (await readFile(join(root, "runtime", "callback-audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(audit.at(-1)).toMatchObject({
      action: "notify_review_retriggered",
      songId: "song-018",
      result: "notified",
      reason: "notify_review_retriggered",
      actor: "manual_notify_retrigger"
    });
  });
});
