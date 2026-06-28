import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { registerRoutes } from "../src/routes";
import { artistPersonaBlockEnd, artistPersonaBlockStart, writeArtistPersona } from "../src/services/personaFileBuilder.js";
import { patchResolvedConfig, readResolvedConfig } from "../src/services/runtimeConfig.js";
import { writeSoulPersona } from "../src/services/soulFileBuilder.js";
import type { PersonaRouteResponse } from "../src/routes/responseBuilders.js";

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "persona-route-"));
  mkdirSync(join(root, "runtime"), { recursive: true });
  return root;
}

function createMockRequest(method: string, url: string, body?: unknown): IncomingMessage {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const req = Readable.from(payload ? [payload] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = payload ? { "content-type": "application/json" } : {};
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
    json: <T>() => JSON.parse(body) as T,
    header: (name: string) => headers[name.toLowerCase()]
  };
}

function personaHandler(): RouteHandler {
  const registered = new Map<string, RouteHandler>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: RouteHandler }) {
      registered.set(definition.path, definition.handler);
    }
  });
  const handler = registered.get("/plugins/artist-runtime/api/persona");
  expect(handler).toBeTruthy();
  return handler as RouteHandler;
}

async function callPersona(handler: RouteHandler, method: string, path: string, root: string, body: Record<string, unknown> = {}) {
  const response = createMockResponse();
  await handler(
    createMockRequest(method, `/plugins/artist-runtime/api/persona${path}`, {
      config: { artist: { workspaceRoot: root } },
      ...body
    }),
    response.res
  );
  expect(response.header("content-type")).toContain("application/json");
  return response.json<Record<string, unknown>>();
}

describe("persona route", () => {
  it("returns canonical persona inputs plus generated/internal projections", async () => {
    const root = makeWorkspace();
    await writeArtistPersona(root, { artistName: "Neon Relay" });
    await patchResolvedConfig(root, {
      artist: {
        mode: "public_artist",
        artistId: "artist",
        profilePath: "ARTIST.md",
        workspaceRoot: root,
        identity: { displayName: "Neon Relay" }
      }
    });
    await writeSoulPersona(root, { conversationTone: "short and precise", refusalStyle: "refuse weak ideas plainly" });
    writeFileSync(join(root, "PRODUCER.md"), "# PRODUCER\n\nraw producer\n", "utf8");
    writeFileSync(join(root, "INNER.md"), "# INNER\n\nraw inner\n", "utf8");

    const response = await callPersona(personaHandler(), "GET", "", root) as unknown as PersonaRouteResponse;

    expect(response.artist.artistName).toBe("Neon Relay");
    expect(response.soul.conversationTone).toBe("short and precise");
    expect(response.identity.readOnly).toBe(true);
    expect(response.identity.source).toBe("derived");
    expect(response.identity.text).toContain("Display name: Neon Relay");
    expect(response.producer.text).toContain("raw producer");
    expect(response.inner.text).toContain("raw inner");
    expect(response.inner.readOnly).toBe(true);
    expect(response.inner.source).toBe("internal");
    expect(response.aiDraftSupported).toEqual(["artist", "soul"]);
    expect(response.setup.needsSetup).toBe(false);
    expect(response.setup.reasonsText).toBe("");
    expect(response.audit.summary.filled).toBeGreaterThan(0);
    expect(response.audit.issues).toEqual([]);
  });

  it("writes ARTIST.md through the marker-aware writer and preserves operator text outside markers", async () => {
    const root = makeWorkspace();
    writeFileSync(
      join(root, "ARTIST.md"),
      [
        "# ARTIST.md",
        "",
        "operator note before",
        artistPersonaBlockStart,
        "old block",
        artistPersonaBlockEnd,
        "operator note after"
      ].join("\n"),
      "utf8"
    );

    const response = await callPersona(personaHandler(), "POST", "/artist", root, {
      artist: {
        artistName: "Glass Commuter",
        identityLine: "Turns commute damage into songs.",
        soundDna: "dry drums, low synth",
        obsessions: "station light, receipts",
        lyricsRules: "no slogans",
        socialVoice: "plain and short"
      }
    });
    const contents = readFileSync(join(root, "ARTIST.md"), "utf8");

    expect(response.ok).toBe(true);
    await expect(readResolvedConfig(root)).resolves.toMatchObject({
      artist: { identity: { displayName: "Glass Commuter" } }
    });
    expect(contents).toContain("operator note before");
    expect(contents).toContain("operator note after");
    expect(contents).not.toContain("Artist name: Glass Commuter");
    expect(contents).not.toContain("old block");
  });

  it("keeps IDENTITY.md and INNER.md read-only and rejects secret-like snapshot text", async () => {
    const root = makeWorkspace();
    const handler = personaHandler();

    const written = await callPersona(handler, "POST", "/identity", root, {
      identity: { text: "# IDENTITY.md\n\nplain snapshot" }
    });
    const rejected = await callPersona(handler, "POST", "/producer", root, {
      producer: { text: "TELEGRAM_BOT_TOKEN=do-not-write" }
    });
    const inner = await callPersona(handler, "POST", "/inner", root, {
      inner: { text: "# INNER.md\n\nplain snapshot" }
    });

    expect(written.error).toBe("identity_projection_read_only");
    expect(written.statusCode).toBe(400);
    expect(inner.error).toBe("inner_projection_read_only");
    expect(inner.statusCode).toBe(400);
    expect(rejected.error).toBe("persona_block_contains_secret_like_text");
    expect(rejected.statusCode).toBe(400);
  });

  it("proposes whitelisted setup fields and marks setup complete from web", async () => {
    const root = makeWorkspace();
    await writeArtistPersona(root, { artistName: "Neon Relay", obsessions: "night trains" });
    await writeSoulPersona(root, { conversationTone: "short and precise", refusalStyle: "refuse weak ideas plainly" });
    const handler = personaHandler();

    const proposed = await callPersona(handler, "POST", "/propose", root, { fields: ["artistName", "soul-tone", "producerFacts"] });
    const rejected = await callPersona(handler, "POST", "/propose", root, { fields: ["identity"] });
    const completed = await callPersona(handler, "POST", "/complete", root);

    expect((proposed.drafts as Array<{ field: string }>).map((draft) => draft.field)).toEqual(["artistName", "soul-tone", "producerFacts"]);
    expect(rejected.error).toBe("invalid_persona_fields");
    expect(rejected.statusCode).toBe(400);
    expect((completed.setup as { marker?: { source: string } }).marker?.source).toBe("web");
  });
});
