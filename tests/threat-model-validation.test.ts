import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRoutes, buildStatusResponse } from "../src/routes/index.js";
import { createSongIdea } from "../src/services/songIdeation.js";
import { updateSongState } from "../src/services/artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "../src/services/promptLedger.js";
import { prepareSocialAssets } from "../src/services/socialAssets.js";
import { publishSocialAction } from "../src/services/socialPublishing.js";

function makeWorkspace(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "runtime"), { recursive: true });
  return root;
}

function createMockRequest(method: string, url: string, body?: string, headers?: Record<string, string>): IncomingMessage {
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = headers ?? {};
  return req;
}

function createMockResponse(): ServerResponse {
  return {
    statusCode: 200,
    headersSent: false,
    setHeader() {
      return this;
    },
    end() {
      this.headersSent = true;
      return this;
    }
  } as unknown as ServerResponse;
}

function configUpdateHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void {
  const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void>();
  registerRoutes({
    registerHttpRoute(definition: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void }) {
      registered.set(definition.path, definition.handler);
    }
  });
  const handler = registered.get("/plugins/artist-runtime/api/config/update");
  if (!handler) {
    throw new Error("config/update handler was not registered");
  }
  return handler;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("threat model validation", () => {
  it("keeps Prompt Ledger contents out of the status gateway response", async () => {
    const root = makeWorkspace("artist-runtime-threat-ledger-");
    const secretPromptText = "SECRET_PROMPT_LEDGER_TEXT_DO_NOT_SURFACE";

    const idea = await createSongIdea({
      workspaceRoot: root,
      title: "Cold Antenna",
      artistReason: "public brief reason"
    });
    await appendPromptLedger(getSongPromptLedgerPath(root, idea.songId), createPromptLedgerEntry({
      stage: "lyrics_generation",
      songId: idea.songId,
      actor: "artist",
      inputRefs: ["private-draft"],
      outputRefs: ["lyrics.md"],
      outputSummary: secretPromptText
    }));

    const status = await buildStatusResponse({ artist: { workspaceRoot: root } });

    expect(JSON.stringify(status)).not.toContain(secretPromptText);
    expect(await readFile(join(root, "songs", "song-001", "prompts", "prompt-ledger.jsonl"), "utf8")).toContain(secretPromptText);
  });

  it("rejects invalid HTTP config override bodies through schema validation", async () => {
    const root = makeWorkspace("artist-runtime-threat-config-");
    const handler = configUpdateHandler();

    await expect(
      handler(
        createMockRequest(
          "POST",
          "/plugins/artist-runtime/api/config/update",
          JSON.stringify({
            config: { artist: { workspaceRoot: root } },
            patch: { music: { suno: { dailyCreditLimit: 0 } } }
          }),
          { "content-type": "application/json" }
        ),
        createMockResponse()
      )
    ).rejects.toThrow("invalid config: config.music.suno.dailyCreditLimit must be an integer between 1 and 1000");
  });

  it("keeps credential-like environment values out of status output", async () => {
    const root = makeWorkspace("artist-runtime-threat-credential-");
    const secretValue = "secret-token-value-that-must-not-leak";
    vi.stubEnv(`${"OPENCLAW_" + "INSTAGRAM_ACCESS_TOKEN"}`, secretValue);

    const status = await buildStatusResponse({ artist: { workspaceRoot: root } });

    expect(JSON.stringify(status)).not.toContain(secretValue);
  });

  it("keeps generated workspace artifacts under song-scoped directories", async () => {
    const root = makeWorkspace("artist-runtime-threat-artifacts-");
    const idea = await createSongIdea({ workspaceRoot: root, title: "Safe Container" });
    await updateSongState(root, idea.songId, { selectedTakeId: "take-001" });

    const assets = await prepareSocialAssets({ workspaceRoot: root, songId: idea.songId });
    const rootEntries = await readdir(root);

    expect(assets.every((asset) => asset.textPath.startsWith(join(root, "songs", idea.songId, "social")))).toBe(true);
    expect(rootEntries).not.toContain("assets.json");
  });

  it("fails closed on social budget-bypass attempts while live-go is unarmed", async () => {
    const root = makeWorkspace("artist-runtime-threat-budget-");
    const idea = await createSongIdea({ workspaceRoot: root, title: "No Bypass" });

    const { result, entry } = await publishSocialAction({
      workspaceRoot: root,
      songId: idea.songId,
      platform: "x",
      postType: "observation",
      text: "Nothing crosses the wire.",
      config: {
        autopilot: { dryRun: false },
        distribution: {
          enabled: true,
          liveGoArmed: false,
          platforms: {
            x: { enabled: true, liveGoArmed: true, authority: "auto_publish" }
          }
        }
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(entry.policyDecision.allowed).toBe(false);
    expect(entry.policyDecision.reason).toBe("dry-run blocks social publish");
  });
});
