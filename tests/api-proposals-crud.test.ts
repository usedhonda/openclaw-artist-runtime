import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRoutes } from "../src/routes";
import * as changeSetApplier from "../src/services/changeSetApplier";
import { createConversationalSession, listPendingProposalDetails } from "../src/services/conversationalSession";
import { ensureArtistWorkspace } from "../src/services/artistWorkspace";
import type { ChangeSetProposal } from "../src/services/freeformChangesetProposer";

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

function proposal(id = "changeset-song-test"): ChangeSetProposal {
  return {
    id,
    domain: "song",
    summary: "Song note change waiting.",
    fields: [
      {
        domain: "song",
        targetFile: "songs/where-it-played/song.md",
        field: "notes",
        currentValue: "old note",
        proposedValue: "new note",
        reasoning: "producer approved direction",
        status: "proposed"
      }
    ],
    warnings: [],
    createdAt: "2026-04-29T01:00:00.000Z",
    source: "conversation",
    songId: "where-it-played"
  };
}

function registerProposalHandler() {
  const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      registered.set(definition.path, definition.handler);
    }
  });
  const handler = registered.get("/plugins/artist-runtime/api/proposals");
  if (!handler) {
    throw new Error("proposal route not registered");
  }
  return handler;
}

async function seedSession(root: string, pendingChangeSet: ChangeSetProposal, chatId = 1): Promise<void> {
  await createConversationalSession(root, {
    chatId,
    userId: 2,
    topic: { kind: "song", songId: pendingChangeSet.songId },
    pendingChangeSet,
    now: Date.now()
  });
}

async function invoke(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void,
  method: string,
  url: string,
  root: string,
  payload: Record<string, unknown> = {}
) {
  const response = createMockResponse();
  await handler(
    createMockRequest(
      method,
      url,
      JSON.stringify({ ...payload, config: { artist: { workspaceRoot: root } } }),
      { "content-type": "application/json" }
    ),
    response.res
  );
  return response;
}

describe("proposals route CRUD", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists pending proposal details and empty state", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-proposals-list-"));
    await ensureArtistWorkspace(root);
    const handler = registerProposalHandler();

    let response = await invoke(handler, "GET", "/plugins/artist-runtime/api/proposals", root);
    expect(response.readStatus()).toBe(200);
    expect(response.json()).toEqual({ proposals: [] });

    await seedSession(root, proposal());
    response = await invoke(handler, "GET", "/plugins/artist-runtime/api/proposals", root);
    expect(response.json()).toMatchObject({
      proposals: [
        {
          id: "changeset-song-test",
          domain: "song",
          summary: "Song note change waiting.",
          fields: [{ field: "notes", currentValue: "old note", proposedValue: "new note" }]
        }
      ]
    });
  });

  it("applies a proposal through changeSetApplier and clears the session", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-proposals-yes-"));
    await ensureArtistWorkspace(root);
    const pending = proposal();
    await seedSession(root, pending);
    const applySpy = vi.spyOn(changeSetApplier, "applyChangeSet").mockResolvedValue({
      applied: pending.fields,
      skipped: [],
      warnings: [],
      backups: { sessionId: pending.id, entries: [] }
    });
    const handler = registerProposalHandler();

    const response = await invoke(handler, "POST", `/plugins/artist-runtime/api/proposals/${pending.id}/yes`, root);

    expect(response.readStatus()).toBe(200);
    expect(response.json()).toMatchObject({
      status: "applied",
      applyResult: { applied: [{ field: "notes" }], skipped: [], warnings: [] }
    });
    expect(applySpy).toHaveBeenCalledWith(root, pending);
    expect(await listPendingProposalDetails(root)).toEqual([]);
  });

  it("cancels a proposal without applying it", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-proposals-no-"));
    await ensureArtistWorkspace(root);
    const pending = proposal();
    await seedSession(root, pending);
    const applySpy = vi.spyOn(changeSetApplier, "applyChangeSet");
    const handler = registerProposalHandler();

    const response = await invoke(handler, "POST", `/plugins/artist-runtime/api/proposals/${pending.id}/no`, root);

    expect(response.json()).toMatchObject({ status: "discarded" });
    expect(applySpy).not.toHaveBeenCalled();
    expect(await listPendingProposalDetails(root)).toEqual([]);
  });

  it("edits proposed field values in the pending session", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-proposals-edit-"));
    await ensureArtistWorkspace(root);
    const pending = proposal();
    await seedSession(root, pending);
    const handler = registerProposalHandler();

    const response = await invoke(
      handler,
      "POST",
      `/plugins/artist-runtime/api/proposals/${pending.id}/edit`,
      root,
      { fields: { notes: "edited note from console" } }
    );

    expect(response.json()).toMatchObject({
      status: "updated",
      proposal: {
        id: pending.id,
        fields: [{ field: "notes", proposedValue: "edited note from console", status: "proposed" }]
      }
    });
    expect((await listPendingProposalDetails(root))[0]?.fields[0]?.proposedValue).toBe("edited note from console");
  });

  it("returns errors for missing and duplicate proposal ids", async () => {
    const root = mkdtempSync(join(tmpdir(), "artist-runtime-proposals-error-"));
    await ensureArtistWorkspace(root);
    const handler = registerProposalHandler();

    let response = await invoke(handler, "POST", "/plugins/artist-runtime/api/proposals/missing/yes", root);
    expect(response.json()).toMatchObject({ status: "already_resolved" });

    await seedSession(root, proposal("dup"), 10);
    await seedSession(root, proposal("dup"), 11);
    response = await invoke(handler, "POST", "/plugins/artist-runtime/api/proposals/dup/no", root);
    expect(response.json()).toEqual({ error: "proposal_id_not_unique", proposalId: "dup" });
  });
});
